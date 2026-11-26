// Rules of the HRMS employee import (HRMS_API.md): request shape, per-employee validation and what each row would do.
// Pure apart from the shared employee form rules, so the unit tests run it directly. SERVER ONLY.
import { parseEmployee } from "./validation.ts";

export const MAX_EMPLOYEES = 100;
export const MAX_BODY_BYTES = 100_000;

const FIELDS = [
  "external_ref",
  "employee_code",
  "first_name",
  "last_name",
  "work_email",
  "department",
  "position",
  "employment_type",
  "status",
  "hire_date",
  "max_weekly_hours",
  "location",
] as const;
const EXTERNAL_REF = /^[A-Za-z0-9_.:-]{1,64}$/;

export type ImportMode = "preview" | "apply";
export type Existing = { external_ref: string | null; employee_code: string; email: string; profile_id: string | null };
export type Org = { departments: { id: string; name: string }[]; positions: { id: string; title: string; department_id: string }[] };

export type EmployeeRow = {
  external_ref: string;
  employee_code: string;
  first_name: string;
  last_name: string;
  email: string;
  department_id: string;
  position_id: string;
  employment_type: "full_time" | "part_time" | "contract";
  status: "active" | "on_leave" | "inactive";
  hire_date: string;
  max_weekly_hours: number;
  location: string | null;
};

/** What happens to one entry. Errors name fields, never echo personal values. */
export type RowResult = { index: number; external_ref: string | null; action: "create" | "update" | "reject"; errors: string[] };
export type ImportPlan = { results: RowResult[]; rows: EmployeeRow[]; created: number; updated: number; rejected: number };

type Raw = Record<string, unknown>;
const isObject = (value: unknown): value is Raw => typeof value === "object" && value !== null && !Array.isArray(value);

/** `{ "mode": "preview" | "apply", "employees": [...] }`. Without a mode it is a preview. */
export function parseImportBody(text: string): { ok: true; mode: ImportMode; employees: unknown[] } | { ok: false; message: string } {
  const fail = (message: string) => ({ ok: false as const, message });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return fail("The body must be valid JSON.");
  }
  if (!isObject(body)) return fail("The body must be a JSON object.");
  if (Object.keys(body).some((key) => key !== "mode" && key !== "employees")) return fail('Only "mode" and "employees" are accepted.');
  const mode = body.mode ?? "preview";
  if (mode !== "preview" && mode !== "apply") return fail('mode must be "preview" or "apply".');
  if (!Array.isArray(body.employees) || !body.employees.length) return fail("employees must be a non-empty list.");
  if (body.employees.length > MAX_EMPLOYEES) return fail(`At most ${MAX_EMPLOYEES} employees per request.`);
  return { ok: true, mode, employees: body.employees };
}

const lower = (value: unknown) => (typeof value === "string" ? value.trim().toLowerCase() : "");

/** Validates every entry against the file itself and the current records. Nothing is written here. */
export function planImport(entries: readonly unknown[], existing: readonly Existing[], org: Org): ImportPlan {
  const count = (key: string) => {
    const seen = new Map<string, number>();
    for (const entry of entries) {
      const value = isObject(entry) ? lower(entry[key]) : "";
      if (value) seen.set(value, (seen.get(value) ?? 0) + 1);
    }
    return seen;
  };
  const refs = count("external_ref");
  const codes = count("employee_code");
  const emails = count("work_email");
  const byRef = new Map(existing.filter((e) => e.external_ref).map((e) => [e.external_ref!.toLowerCase(), e]));

  const results: RowResult[] = [];
  const rows: EmployeeRow[] = [];

  entries.forEach((entry, index) => {
    const errors: string[] = [];
    if (!isObject(entry)) {
      results.push({ index, external_ref: null, action: "reject", errors: ["Each employee must be an object."] });
      return;
    }
    const ref = typeof entry.external_ref === "string" ? entry.external_ref : "";
    const unknown = Object.keys(entry).filter((key) => !(FIELDS as readonly string[]).includes(key));
    if (unknown.length) errors.push(`Unknown field(s): ${unknown.map((k) => k.slice(0, 40)).join(", ")}.`);
    // Every field is required, so an import can never blank a value by leaving it out. location may be null.
    for (const field of FIELDS) {
      const value = entry[field];
      if (field === "max_weekly_hours") {
        if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 168 || Math.round(value * 100) !== value * 100)
          errors.push("max_weekly_hours must be a number from 0 to 168.");
      } else if (field === "location") {
        if (value !== null && (typeof value !== "string" || !value.trim())) errors.push("location must be text or null.");
      } else if (typeof value !== "string" || !value.trim()) errors.push(`${field} is required.`);
    }
    if (ref && !EXTERNAL_REF.test(ref)) errors.push("external_ref may use letters, digits and _ . : - (64 at most).");
    if ((refs.get(lower(ref)) ?? 0) > 1) errors.push("external_ref appears more than once in this request.");
    if ((codes.get(lower(entry.employee_code)) ?? 0) > 1) errors.push("employee_code appears more than once in this request.");
    if ((emails.get(lower(entry.work_email)) ?? 0) > 1) errors.push("work_email appears more than once in this request.");

    const department = org.departments.find((d) => d.name.toLowerCase() === lower(entry.department));
    const position = department && org.positions.find((p) => p.department_id === department.id && p.title.toLowerCase() === lower(entry.position));
    if (lower(entry.department) && !department) errors.push("department does not exist.");
    else if (department && lower(entry.position) && !position) errors.push("position does not exist in that department.");

    // The same rules as the admin's employee form.
    const form = new FormData();
    for (const [name, value] of Object.entries({ ...entry, email: entry.work_email, department_id: department?.id, position_id: position?.id }))
      if (typeof value === "string") form.set(name, value);
    const parsed = parseEmployee(form);
    if (!errors.length) errors.push(...Object.entries(parsed.errors).map(([field, message]) => `${field}: ${message}`));

    const current = byRef.get(lower(ref));
    if (current && current.external_ref !== ref) errors.push("external_ref differs only by letter case from an existing one.");
    const others = existing.filter((e) => e !== current);
    if (others.some((e) => e.employee_code.toLowerCase() === lower(entry.employee_code))) errors.push("employee_code belongs to another employee.");
    if (others.some((e) => e.email.toLowerCase() === lower(entry.work_email))) errors.push("work_email belongs to another employee.");
    if (current?.profile_id && current.email.toLowerCase() !== lower(entry.work_email))
      errors.push("work_email cannot change: this employee has a login.");

    if (errors.length || !parsed.data) {
      results.push({ index, external_ref: EXTERNAL_REF.test(ref) ? ref : null, action: "reject", errors });
      return;
    }
    // Listed field by field: nothing else from the request, and never a login id, reaches the database.
    const { employee_code, first_name, last_name, email, department_id, position_id, employment_type, status, hire_date, location } = parsed.data;
    rows.push({
      external_ref: ref,
      employee_code,
      first_name,
      last_name,
      email,
      department_id,
      position_id,
      employment_type,
      status,
      hire_date,
      max_weekly_hours: entry.max_weekly_hours as number,
      location,
    });
    results.push({ index, external_ref: ref, action: current ? "update" : "create", errors: [] });
  });

  const total = (action: RowResult["action"]) => results.filter((r) => r.action === action).length;
  return { results, rows, created: total("create"), updated: total("update"), rejected: total("reject") };
}
