"use server";

import { reminderText } from "@/lib/reminders";
import { sendRemindersForTomorrow } from "@/lib/reminders-server";
import { createHash } from "node:crypto";
import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/validation";
import {
  ATTENDANCE_LOCKED,
  SHIFT_FIELD_LABELS,
  assessShiftEdit,
  assignmentGuard,
  changedFields,
  matchOverrides,
  parseShift,
  publishGuard,
  addDays,
  toManilaParts,
  unpublishGuard,
  validateAssignment,
  type Assignee,
  type ShiftLike,
  type ShiftStatus,
  type ShiftValues,
  type ValidationResult,
} from "@/lib/scheduling";
import type { ActionState } from "@/components/action-form";
import { assignmentContext, fingerprintAssignment, loadEmployeeData, loadShiftState } from "./assignment-data";
import { WEEK_PUBLISH_MAX, fingerprintWeekPlan, loadWeekPlan, parseWeekScope } from "./week-publish";
import { notifyShifts, shiftWhen } from "./notify";
import { reportText, signNotice, type NoticeKind, type NotifyReport } from "@/lib/telegram-messages";

// Shift lifecycle: create, edit and cancel. There is deliberately NO delete (a check-then-delete would race with a
// concurrent assignment and the cascade would remove it). Every action re-checks the admin role on the server, reads
// fresh data, applies the shared rules from lib/scheduling.ts, and writes through the caller's own session (RLS applies).
//
// Concurrency, stated honestly: a change to this shift row is protected by an updated_at check, and a published-shift
// edit must match the exact state the admin previewed. Nothing stops ANOTHER shift from changing between the check and
// the write: the database has no overlap guard until the S2 triggers are applied.

export type ShiftChange = { label: string; from: string; to: string };
export type PreviewEmployee = { id: string; name: string; code: string; unchanged: string[] };
export type ShiftPreview = { fingerprint: string; changes: ShiftChange[]; employees: PreviewEmployee[] };
export type BlockedEmployee = { id: string; name: string; code: string; problems: string[] };
export type ShiftActionState = ActionState & { preview?: ShiftPreview; blocked?: BlockedEmployee[] };

type Supabase = Awaited<ReturnType<typeof createClient>>;

const done = (prev: ActionState, success: string): ShiftActionState => ({ success, done: (prev.done ?? 0) + 1 });
const FIX_FIELDS = "Check the highlighted fields.";

// Telegram messages go out only after a write has succeeded (see notify.ts, which never throws). Assigning and cancelling
// remove the part of the page that shows the message, so their result travels in a short-lived server-signed notice.
function showNotice(shiftId: string, kind: NoticeKind, report: NotifyReport): never {
  const notice = signNotice(shiftId, { kind, report }, process.env.SUPABASE_SECRET_KEY ?? "", new Date());
  redirect(`/admin/schedules/${shiftId}?notice=${notice}`);
}

async function checkDepartmentAndPosition(supabase: Supabase, input: Pick<ShiftValues, "department_id" | "position_id">): Promise<ShiftActionState | null> {
  const { data: department } = await supabase.from("departments").select("id").eq("id", input.department_id).maybeSingle();
  if (!department) return { fieldErrors: { department_id: "This department no longer exists." }, error: FIX_FIELDS };
  if (input.position_id) {
    const { data: position } = await supabase.from("positions").select("department_id").eq("id", input.position_id).maybeSingle();
    if (!position) return { fieldErrors: { position_id: "This position no longer exists." }, error: FIX_FIELDS };
    if (position.department_id !== input.department_id)
      return { fieldErrors: { position_id: "This position belongs to a different department." }, error: FIX_FIELDS };
  }
  return null;
}

type ShiftRow = {
  id: string;
  title: string;
  department_id: string;
  position_id: string | null;
  starts_at: string;
  ends_at: string;
  required_headcount: number;
  status: ShiftStatus;
  notes: string | null;
  updated_at: string;
};

type Context = {
  shift: ShiftRow;
  assignees: Assignee[];
  people: Map<string, { name: string; code: string }>;
  assignmentCount: number;
  attendanceCount: number;
};

// Everything an edit needs, read fresh: the shift, who is on it, their availability and their other shifts.
async function loadContext(supabase: Supabase, id: string): Promise<Context | "missing" | "error"> {
  const { data: shift, error } = await supabase
    .from("shifts")
    .select("id, title, department_id, position_id, starts_at, ends_at, required_headcount, status, notes, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (error) return "error";
  if (!shift) return "missing";

  const { data: rows, error: rowsError } = await supabase
    .from("shift_assignments")
    .select("id, employee:employees(id, employee_code, first_name, last_name, status, department_id, position_id, max_weekly_hours)")
    .eq("shift_id", id);
  if (rowsError || !rows) return "error";

  const employees = rows.flatMap((r) => (r.employee ? [r.employee] : []));
  const ids = employees.map((e) => e.id);
  const none = { data: [] as never[], count: 0, error: null };
  const [availability, others, attendance] = await Promise.all([
    ids.length ? supabase.from("employee_availability").select("employee_id, day_of_week, start_time, end_time").in("employee_id", ids) : none,
    ids.length
      ? supabase.from("shift_assignments").select("employee_id, shift:shifts(id, starts_at, ends_at, status)").in("employee_id", ids).neq("shift_id", id)
      : none,
    rows.length
      ? supabase.from("attendance_records").select("id", { count: "exact", head: true }).in("shift_assignment_id", rows.map((r) => r.id))
      : none,
  ]);
  if (availability.error || others.error || attendance.error) return "error";

  const assignees: Assignee[] = employees.map((e) => ({
    employee: { id: e.id, status: e.status, department_id: e.department_id, position_id: e.position_id, max_weekly_hours: e.max_weekly_hours },
    availability: (availability.data ?? []).filter((a) => a.employee_id === e.id),
    otherShifts: (others.data ?? []).flatMap((o) => (o.employee_id === e.id && o.shift ? [o.shift] : [])),
  }));

  return {
    shift: shift as ShiftRow,
    assignees,
    people: new Map(employees.map((e) => [e.id, { name: `${e.first_name} ${e.last_name}`, code: e.employee_code }])),
    assignmentCount: rows.length,
    attendanceCount: attendance.count ?? 0,
  };
}

const valuesOf = (s: ShiftRow): ShiftValues => ({
  title: s.title,
  department_id: s.department_id,
  position_id: s.position_id,
  starts_at: s.starts_at,
  ends_at: s.ends_at,
  required_headcount: s.required_headcount,
  notes: s.notes,
});

const likeOf = (id: string, status: ShiftStatus, v: ShiftValues): ShiftLike => ({
  id,
  status,
  department_id: v.department_id,
  position_id: v.position_id,
  starts_at: v.starts_at,
  ends_at: v.ends_at,
  required_headcount: v.required_headcount,
});

const manila = (iso: string) => {
  const p = toManilaParts(iso);
  return `${p.date} ${p.time}`;
};

/** The shift as it was before an edit, worded for the "Before" line of the change message. Never throws. */
async function previousOf(supabase: Supabase, shift: ShiftRow) {
  const [department, position] = await Promise.all([
    supabase.from("departments").select("name").eq("id", shift.department_id).maybeSingle(),
    shift.position_id ? supabase.from("positions").select("title").eq("id", shift.position_id).maybeSingle() : null,
  ]);
  return {
    title: shift.title,
    when: shiftWhen(shift.starts_at, shift.ends_at),
    department: department.data?.name ?? "Unknown department",
    position: position?.data?.title ?? null,
  };
}

// Identifies exactly what the admin previewed: the shift row version, the new values, and every assignee's rule inputs
// (status, hours, availability, other shifts). If any of it changes before confirmation, the fingerprint no longer matches.
function fingerprintOf(ctx: Context, input: ShiftValues): string {
  const byId = <T extends { id?: string }>(a: T, b: T) => String(a.id).localeCompare(String(b.id));
  const stable = {
    shift: { id: ctx.shift.id, updated_at: ctx.shift.updated_at, status: ctx.shift.status },
    input,
    assignees: [...ctx.assignees]
      .sort((a, b) => a.employee.id.localeCompare(b.employee.id))
      .map((a) => ({
        employee: a.employee,
        availability: [...a.availability].sort((x, y) => x.day_of_week - y.day_of_week || x.start_time.localeCompare(y.start_time) || x.end_time.localeCompare(y.end_time)),
        otherShifts: [...a.otherShifts].sort(byId),
      })),
  };
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

async function describeChanges(supabase: Supabase, before: ShiftValues, after: ShiftValues, fields: (keyof ShiftValues)[]): Promise<ShiftChange[]> {
  const deptIds = [before.department_id, after.department_id];
  const posIds = [before.position_id, after.position_id].filter((x): x is string => Boolean(x));
  const [{ data: depts }, { data: poss }] = await Promise.all([
    supabase.from("departments").select("id, name").in("id", deptIds),
    posIds.length ? supabase.from("positions").select("id, title").in("id", posIds) : { data: [] as { id: string; title: string }[] },
  ]);
  const dept = (id: string | null) => depts?.find((d) => d.id === id)?.name ?? "Unknown";
  const pos = (id: string | null) => (id ? (poss?.find((p) => p.id === id)?.title ?? "Unknown") : "None");
  const show = (k: keyof ShiftValues, v: ShiftValues): string => {
    switch (k) {
      case "department_id": return dept(v.department_id);
      case "position_id": return pos(v.position_id);
      case "starts_at": return `${manila(v.starts_at)} Manila`;
      case "ends_at": return `${manila(v.ends_at)} Manila`;
      case "notes": return v.notes ?? "(none)";
      default: return String(v[k]);
    }
  };
  return fields.map((k) => ({ label: SHIFT_FIELD_LABELS[k], from: show(k, before), to: show(k, after) }));
}

// ---------------------------------------------------------------------------

export async function createShift(_prev: ShiftActionState, formData: FormData): Promise<ShiftActionState> {
  const user = await requireRole("admin");
  const { data: input, errors } = parseShift(formData);
  if (!input) return { fieldErrors: errors, error: FIX_FIELDS };

  const supabase = await createClient();
  const invalid = await checkDepartmentAndPosition(supabase, input);
  if (invalid) return invalid;

  // New shifts are always drafts; publishing is a separate step.
  const { data, error } = await supabase
    .from("shifts")
    .insert({ ...input, status: "draft", created_by: user.id })
    .select("id")
    .single();
  if (error) return { error: "Could not create the shift. Please try again." };

  redirect(`/admin/schedules/${data.id}?created=1`);
}

export async function updateShift(id: string, prev: ShiftActionState, formData: FormData): Promise<ShiftActionState> {
  await requireRole("admin");
  if (!isUuid(id)) return { error: "Unknown shift." };
  const { data: input, errors } = parseShift(formData);
  if (!input) return { fieldErrors: errors, error: FIX_FIELDS };

  const supabase = await createClient();
  const ctx = await loadContext(supabase, id);
  if (ctx === "missing") return { error: "This shift no longer exists." };
  if (ctx === "error") return { error: "Could not load the shift. Please try again." };
  const { shift } = ctx;
  if (shift.status === "cancelled") return { error: "A cancelled shift cannot be edited." };

  // The form carries the version of the shift it was opened on. If the shift changed since, refuse instead of overwriting.
  const expected = formData.get("expected_updated_at");
  if (typeof expected !== "string" || expected !== shift.updated_at)
    return { error: "This shift was changed since you opened this page. Reload the page to see the latest version, then repeat your edit." };

  const invalid = await checkDepartmentAndPosition(supabase, input);
  if (invalid) return invalid;

  const before = valuesOf(shift);
  const changed = changedFields(before, input);
  if (!changed.length) return { error: "There are no changes to save." };

  // Attendance exists: the shift happened. Time, department and position stay as recorded; title, notes and headcount may change.
  const locked = ctx.attendanceCount > 0 ? changed.filter((f) => ATTENDANCE_LOCKED.includes(f)) : [];
  if (locked.length)
    return {
      error: `This shift has attendance records, so its ${locked.map((f) => SHIFT_FIELD_LABELS[f].toLowerCase()).join(", ")} cannot be changed.`,
    };

  // Judge the edit for everyone on the shift. A new problem (or a worse one) refuses the save; nothing is removed.
  const assessment = assessShiftEdit(likeOf(id, shift.status, before), likeOf(id, shift.status, input), ctx.assignees);
  const blocked: BlockedEmployee[] = assessment
    .filter((a) => a.added.length)
    .map((a) => ({
      id: a.employeeId,
      name: ctx.people.get(a.employeeId)?.name ?? "Unknown employee",
      code: ctx.people.get(a.employeeId)?.code ?? "",
      problems: a.added.map((v) => v.message),
    }));
  if (blocked.length)
    return {
      error: "This change would create new problems for assigned employees, so nothing was saved. Adjust the change, or unassign those employees first.",
      blocked,
    };

  const apply = async (): Promise<ShiftActionState> => {
    const { data: updated, error } = await supabase
      .from("shifts")
      .update(input)
      .eq("id", id)
      .eq("updated_at", shift.updated_at)
      .eq("status", shift.status)
      .select("id");
    if (error) return { error: "Could not save the shift. Please try again." };
    if (!updated.length) return { error: "This shift was changed by someone else while you were editing. Reload the page and try again." };
    const relevant = changed.some((f) => f === "starts_at" || f === "ends_at" || f === "department_id" || f === "position_id");
    const report =
      shift.status === "published" && relevant ? await notifyShifts(supabase, "changed", [id], { previous: await previousOf(supabase, shift) }) : null;
    refresh();
    return done(prev, report ? `Shift saved. ${reportText(report)}` : "Shift saved.");
  };

  // Draft shifts are not visible to employees, so they save directly (after the checks above).
  if (shift.status === "draft") return apply();

  // Published: the admin must see exactly what changes and who is affected, and confirm that exact state.
  const fingerprint = fingerprintOf(ctx, input);
  const confirmed = formData.get("confirm_fingerprint");
  if (typeof confirmed === "string" && confirmed) {
    if (confirmed === fingerprint) return apply();
  }

  const preview: ShiftPreview = {
    fingerprint,
    changes: await describeChanges(supabase, before, input, changed),
    employees: assessment.map((a) => ({
      id: a.employeeId,
      name: ctx.people.get(a.employeeId)?.name ?? "Unknown employee",
      code: ctx.people.get(a.employeeId)?.code ?? "",
      unchanged: a.unchanged.map((v) => v.message),
    })),
  };
  return typeof confirmed === "string" && confirmed
    ? {
        error:
          "What you previewed is no longer current: the form was edited, or the shift or its assignees changed. Review the updated changes below and confirm again.",
        preview,
      }
    : { preview };
}

export async function cancelShift(id: string, prev: ShiftActionState): Promise<ShiftActionState> {
  await requireRole("admin");
  if (!isUuid(id)) return { error: "Unknown shift." };

  const supabase = await createClient();
  const ctx = await loadContext(supabase, id);
  if (ctx === "missing") return { error: "This shift no longer exists." };
  if (ctx === "error") return { error: "Could not load the shift. Please try again." };
  if (ctx.shift.status === "cancelled") return { error: "This shift is already cancelled." };
  if (ctx.attendanceCount > 0) return { error: "This shift has attendance records, so it cannot be cancelled." };

  // Assignments stay exactly as they are: cancelling only changes the shift's status.
  const { data: updated, error } = await supabase
    .from("shifts")
    .update({ status: "cancelled" })
    .eq("id", id)
    .eq("updated_at", ctx.shift.updated_at)
    .eq("status", ctx.shift.status)
    .select("id");
  if (error) return { error: "Could not cancel the shift. Please try again." };
  if (!updated.length) return { error: "This shift was changed by someone else. Reload the page and try again." };

  if (ctx.shift.status === "published") showNotice(id, "cancelled", await notifyShifts(supabase, "cancelled", [id]));
  refresh();
  return done(prev, `Shift cancelled. ${ctx.assignmentCount} assignment(s) were kept for the record.`);
}

// ---------------------------------------------------------------------------
// Publish and unpublish one shift (Phase 3.4a). Only the status column changes; assignments are untouched, and no SQL or
// schema is involved. Publishing makes the shift visible to its assigned employees (existing RLS), so the admin confirms what
// they were shown: the page sends the shift's updated_at and the assigned count it displayed, and the server refuses if either
// changed. An understaffed shift is a warning, not a blocker: it needs the explicit `understaffed_ack` field. The write itself
// is one UPDATE guarded by the status and updated_at it was judged on. Not a concurrency guarantee beyond that (see S2).
// ---------------------------------------------------------------------------

async function changeShiftStatus(
  id: string,
  to: "published" | "draft",
  prev: ShiftActionState,
  formData: FormData,
): Promise<ShiftActionState> {
  await requireRole("admin");
  if (!isUuid(id)) return { error: "Unknown shift." };

  const supabase = await createClient();
  const state = await loadShiftState(supabase, id);
  if (state === "missing") return { error: "This shift no longer exists." };
  if (state === "error") return { error: "Could not load the shift. Please try again." };

  const guard =
    to === "published"
      ? publishGuard(state.shift, state.attendanceCount, new Date())
      : unpublishGuard(state.shift, state.attendanceCount);
  if (guard) return { error: guard };

  if (formData.get("expected_updated_at") !== state.shift.updated_at)
    return { error: "This shift was changed since the page was loaded. Reload the page and review it again." };
  if (formData.get("expected_assigned") !== String(state.assignedIds.length))
    return { error: "The assignments on this shift changed since the page was loaded. Reload the page and review it again." };

  const assigned = state.assignedIds.length;
  const short = state.shift.required_headcount - assigned;
  if (to === "published" && short > 0 && formData.get("understaffed_ack") !== "yes")
    return { error: `This shift has ${assigned} of ${state.shift.required_headcount} people. Publishing an understaffed shift needs your confirmation.` };

  const { data: updated, error } = await supabase
    .from("shifts")
    .update({ status: to })
    .eq("id", id)
    .eq("updated_at", state.shift.updated_at)
    .eq("status", state.shift.status)
    .select("id");
  if (error) return { error: `Could not ${to === "published" ? "publish" : "unpublish"} the shift. Please try again.` };
  if (!updated.length) return { error: "This shift was changed by someone else. Reload the page and try again." };

  const report = await notifyShifts(supabase, to === "published" ? "published" : "withdrawn", [id]);
  refresh();
  return done(
    prev,
    (to === "published"
      ? `Shift published. ${assigned} assigned employee(s) can now see it.`
      : `Shift unpublished. It is a draft again and hidden from employees; ${assigned} assignment(s) were kept.`) + ` ${reportText(report)}`,
  );
}

export async function publishShift(id: string, prev: ShiftActionState, formData: FormData): Promise<ShiftActionState> {
  return changeShiftStatus(id, "published", prev, formData);
}

export async function unpublishShift(id: string, prev: ShiftActionState, formData: FormData): Promise<ShiftActionState> {
  return changeShiftStatus(id, "draft", prev, formData);
}

// ---------------------------------------------------------------------------
// Publish a week (Phase 3.4b). The browser sends only the week, the department filter, a fingerprint and the understaffed
// acknowledgement: the shift ids are ALWAYS recomputed here from fresh data (the same rules as publishGuard), never taken
// from the form. The confirmed set is published by ONE update statement restricted to drafts, so it applies to all of
// them or none; repeating it publishes nothing. No unpublish for a whole week (single-shift unpublish remains).
// Limit, stated honestly: a bulk update cannot check each row's updated_at, so a shift edited between this server's read
// and the write could be published with that edit. The fingerprint catches every change made before the read. S2 is deferred.
// ---------------------------------------------------------------------------

export async function publishWeek(prev: ShiftActionState, formData: FormData): Promise<ShiftActionState> {
  await requireRole("admin");
  const scope = parseWeekScope(formData.get("week"), formData.get("department") ?? "");
  if (!scope) return { error: "Unknown week or department." };

  const supabase = await createClient();
  const plan = await loadWeekPlan(supabase, scope, new Date());
  if (plan === "error") return { error: "Could not load the week. Please try again." };
  if (!plan.eligible.length) return { error: "Nothing to publish: this week has no draft shifts that can be published." };
  if (plan.eligible.length > WEEK_PUBLISH_MAX)
    return { error: `This week has ${plan.eligible.length} shifts to publish, more than the ${WEEK_PUBLISH_MAX} allowed at once. Narrow it with the department filter.` };

  if (formData.get("fingerprint") !== fingerprintWeekPlan(scope, plan))
    return { error: "The week changed since the page was loaded (a shift, its assignments or its status). Reload the page and review it again." };
  if (plan.understaffed > 0 && formData.get("understaffed_ack") !== "yes")
    return { error: `${plan.understaffed} shift(s) are understaffed (${plan.empty} with nobody assigned). Publishing them needs your confirmation.` };

  const ids = plan.eligible.map((s) => s.id);
  const { data: updated, error } = await supabase.from("shifts").update({ status: "published" }).in("id", ids).eq("status", "draft").select("id");
  if (error) return { error: "Could not publish the week. Nothing was changed. Please try again." };

  const report = reportText(await notifyShifts(supabase, "week", updated.map((s) => s.id)));
  refresh();
  const n = updated.length;
  if (n !== ids.length)
    return done(prev, `Published ${n} of ${ids.length} shifts: ${ids.length - n} changed status while publishing. Reload the page to check. ${report}`);
  return done(prev, `Published ${n} shift(s). ${plan.employees} assigned employee(s) can now see them. ${report}`);
}

// ---------------------------------------------------------------------------
// Assignment (Phase 3.3a). Creation goes ONLY through the S1 function public.assign_employee, with an empty override
// list: this milestone refuses every assignment that has a blocker or even one warning (overrides arrive in 3.3b).
// Nothing here trusts the browser: eligibility, the fingerprint, availability and counts are all recomputed from fresh
// server-side data. There is no unassign and no direct insert or delete on shift_assignments.
//
// Limits, stated exactly: the database guarantees that one employee cannot be assigned to the same shift twice (unique
// constraint) and that the assignment is written atomically. It does NOT guarantee that two simultaneous requests cannot
// give one employee overlapping shifts, or push a shift past its headcount: that needs the S2 triggers. The fingerprint
// only detects changes made before the server's read.
// ---------------------------------------------------------------------------

const refusal = (r: ValidationResult) =>
  [
    "Not assigned.",
    r.blockers.length ? `Blocked: ${r.blockers.map((v) => v.message).join(" ")}` : "",
    r.warnings.length ? `Warnings (assigning needs an override with a reason for each): ${r.warnings.map((v) => v.message).join(" ")}` : "",
  ]
    .filter(Boolean)
    .join(" ");

export async function assignEmployee(shiftId: string, employeeId: string, prev: ShiftActionState, formData: FormData): Promise<ShiftActionState> {
  await requireRole("admin");
  if (!isUuid(shiftId) || !isUuid(employeeId)) return { error: "Unknown shift or employee." };

  const supabase = await createClient();
  const state = await loadShiftState(supabase, shiftId);
  if (state === "missing") return { error: "This shift no longer exists." };
  if (state === "error") return { error: "Could not load the shift. Please try again." };

  // Shift-level guards (the S1 function does not check shift state): cancelled, attendance recorded, already ended.
  const guard = assignmentGuard(state.shift, state.attendanceCount, new Date());
  if (guard) return { error: guard };

  // The employee is loaded on their own, not from the department list, so a department mismatch is judged here too.
  const loaded = await loadEmployeeData(supabase, { ids: [employeeId] });
  if (loaded === "error") return { error: "Could not load the employee. Please try again." };
  const data = loaded[0];
  if (!data) return { error: "This employee no longer exists." };

  const result = validateAssignment(assignmentContext(state, data));
  if (result.blockers.length || result.warnings.length) return { error: refusal(result) };

  if (state.shift.status === "published" && formData.get("published_ack") !== "yes")
    return { error: "Assigning to a published shift needs your confirmation. Use the confirmation dialog on the Assign button." };

  const fingerprint = formData.get("fingerprint");
  if (typeof fingerprint !== "string" || fingerprint !== fingerprintAssignment(state, data))
    return { error: "This shift or this employee's data changed since the page was loaded. Reload the page and review the list again." };

  const { error } = await supabase.rpc("assign_employee", { p_shift_id: shiftId, p_employee_id: employeeId, p_overrides: [] });
  if (error) {
    switch (error.code) {
      case "23505":
        return { error: `${data.name} is already assigned to this shift.` };
      case "23P01":
        return { error: `${data.name} was just given an overlapping shift, so nothing was assigned. Reload the page.` };
      case "42501":
        return { error: "You are not allowed to assign shifts." };
      case "P0002":
        return { error: "The shift or the employee no longer exists." };
      default:
        return { error: "Could not assign the employee. Please try again." };
    }
  }

  if (state.shift.status === "published")
    showNotice(shiftId, "assigned", await notifyShifts(supabase, "assigned", [shiftId], { onlyEmployees: [employeeId] }));
  refresh();
  return done(prev, `${data.name} was assigned.`);
}

// ---------------------------------------------------------------------------
// Assignment WITH warning overrides (Phase 3.3b). A separate action: the clean-assignment path above is unchanged.
// Order matters: shift guards, then the fresh validation, then hard blockers are refused BEFORE any override data is read,
// then the published confirmation, the stale-state checks, and only then the exact-match check of the submitted reasons.
// The browser supplies reasons only; the rule ids and the audit `detail` come from this action's own fresh validation.
// Everything is written by the S1 function in one transaction: the assignment and every audit row, or nothing.
//
// Database-enforced (verified against the applied SQL): rule is one of the five warning ids, reason is 10 to 500
// characters after trimming spaces, detail at most 500, required columns not null, atomic with the assignment, audit rows
// cannot be updated or deleted. Application-enforced here (the database does not check them): the override set must equal
// the fresh warning set exactly (no missing, duplicate, extra or unknown rule), hard blockers refuse everything, reasons
// are trimmed of all whitespace and may not be one repeated character.
//
// Same concurrency limits as above, until S2: an override is recorded against warnings computed at read time.
// ---------------------------------------------------------------------------

export async function assignEmployeeWithOverrides(
  shiftId: string,
  employeeId: string,
  prev: ShiftActionState,
  formData: FormData,
): Promise<ShiftActionState> {
  await requireRole("admin");
  if (!isUuid(shiftId) || !isUuid(employeeId)) return { error: "Unknown shift or employee." };

  const supabase = await createClient();
  const state = await loadShiftState(supabase, shiftId);
  if (state === "missing") return { error: "This shift no longer exists." };
  if (state === "error") return { error: "Could not load the shift. Please try again." };

  const guard = assignmentGuard(state.shift, state.attendanceCount, new Date());
  if (guard) return { error: guard };

  const loaded = await loadEmployeeData(supabase, { ids: [employeeId] });
  if (loaded === "error") return { error: "Could not load the employee. Please try again." };
  const data = loaded[0];
  if (!data) return { error: "This employee no longer exists." };

  const result = validateAssignment(assignmentContext(state, data));

  // Hard blockers end it here, before any submitted override is looked at.
  if (result.blockers.length)
    return { error: `Not assigned. Blocked: ${result.blockers.map((v) => v.message).join(" ")} Blockers cannot be overridden.` };
  if (!result.warnings.length)
    return { error: "This employee now has no warnings, so nothing needs overriding. Reload the page and use the normal Assign button." };

  if (state.shift.status === "published" && formData.get("published_ack") !== "yes")
    return { error: "Assigning to a published shift needs your confirmation. Use the confirmation dialog on the button." };

  // Stale-state checks (a safeguard, not a concurrency guarantee): the data fingerprint and the warnings the admin was shown.
  const fingerprint = formData.get("fingerprint");
  if (typeof fingerprint !== "string" || fingerprint !== fingerprintAssignment(state, data))
    return { error: "This shift or this employee's data changed since the page was loaded. Reload the page and review the list again." };
  const shown = String(formData.get("shown_rules") ?? "").split(",").filter(Boolean).sort().join(",");
  const fresh = result.warnings.map((w) => w.rule).sort().join(",");
  if (shown !== fresh) return { error: "The warnings for this assignment changed since you reviewed them. Reload the page and review them again." };

  // Reasons only come from the browser. Anything else named reason_* is an attempted override and is refused by matchOverrides.
  const submitted = [...formData.entries()]
    .filter(([key]) => key.startsWith("reason_"))
    .map(([key, value]) => ({ rule: key.slice("reason_".length), reason: value }));
  const matched = matchOverrides(result, submitted);
  if (!matched.ok) return { error: `Not assigned. ${matched.error}` };

  const { error } = await supabase.rpc("assign_employee", { p_shift_id: shiftId, p_employee_id: employeeId, p_overrides: matched.payload });
  if (error) {
    switch (error.code) {
      case "23505":
        return { error: `${data.name} is already assigned to this shift. Nothing was recorded.` };
      case "23P01":
        return { error: `${data.name} was just given an overlapping shift, so nothing was assigned. Reload the page.` };
      case "23514":
      case "23502":
        return { error: "The database rejected an override (rule or reason), so nothing was assigned and nothing was recorded." };
      case "42501":
        return { error: "You are not allowed to assign shifts." };
      case "P0002":
        return { error: "The shift or the employee no longer exists." };
      default:
        return { error: "Could not assign the employee. Nothing was recorded. Please try again." };
    }
  }

  if (state.shift.status === "published")
    showNotice(shiftId, "assigned", await notifyShifts(supabase, "assigned", [shiftId], { onlyEmployees: [employeeId] }));
  refresh();
  const n = matched.payload.length;
  return done(prev, `${data.name} was assigned with ${n} override${n === 1 ? "" : "s"} recorded.`);
}

// ---------------------------------------------------------------------------
// Manual reminders (Telegram milestone): tomorrow's published shifts (Manila date) across all departments, one combined
// message per employee. No history is kept, so pressing the button again sends again. Timed reminders are not built.
// ---------------------------------------------------------------------------

export async function sendTomorrowReminders(prev: ShiftActionState, formData: FormData): Promise<ShiftActionState> {
  await requireRole("admin");
  const tomorrow = addDays(toManilaParts(new Date()).date, 1);
  if (formData.get("date") !== tomorrow) return { error: "The date changed since the page was loaded. Reload the page and review it again." };

  const run = await sendRemindersForTomorrow("manual");
  if (run.outcome === "not_set_up") return { error: "Telegram is not set up, so no reminders were sent." };
  if (run.outcome === "failed") return { error: "The reminders could not be completed. Check the delivery history below before trying again." };
  if (!run.shifts) return { error: "There are no published shifts tomorrow, so there is nothing to send." };

  return done(prev, `Reminders for ${run.date}: ${reminderText(run.counts)}`);
}
