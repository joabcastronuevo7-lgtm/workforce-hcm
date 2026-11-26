import { overtimeMinutes, workedMinutes, type AttendanceStatus } from "@/lib/attendance-report";
import { addDays, weekBoundsUtc } from "@/lib/scheduling";
import type { Loader } from "./handler";

// The ONLY database reads of the HRMS API. Each names its columns and builds each returned object field by field: adding a
// column to a table never adds it to the API. Never selected here: phone, profile or login ids, roles, availability,
// notes, override records, and anything from the Telegram table.
//
// Paging: the total is counted first, then the page is read (an offset past the end returns an empty page). The two are
// separate reads, not one snapshot.

/** Manila midnight of a date ("weekBoundsUtc" starts at midnight of whatever date it is given). */
const manilaMidnight = (date: string) => weekBoundsUtc(date).start.toISOString();

export const loadEmployees: Loader = async (db, { limit, offset, status, updatedSince }) => {
  let count = db.from("employees").select("id", { count: "exact", head: true });
  if (status) count = count.eq("status", status);
  if (updatedSince) count = count.gte("updated_at", updatedSince);
  const total = await count;
  if (total.error || total.count === null) return null;
  if (offset >= total.count) return { data: [], total: total.count };

  let query = db
    .from("employees")
    .select(
      "employee_code, external_ref, first_name, last_name, email, employment_type, status, hire_date, location, max_weekly_hours, updated_at, department:departments(name), position:positions(title)",
    )
    .order("employee_code")
    .range(offset, offset + limit - 1);
  if (status) query = query.eq("status", status);
  if (updatedSince) query = query.gte("updated_at", updatedSince);
  const { data, error } = await query;
  if (error) return null;
  return {
    total: total.count,
    data: data.map((e) => ({
      employee_code: e.employee_code,
      external_ref: e.external_ref,
      first_name: e.first_name,
      last_name: e.last_name,
      work_email: e.email,
      department: e.department?.name ?? null,
      position: e.position?.title ?? null,
      employment_type: e.employment_type,
      status: e.status,
      hire_date: e.hire_date,
      location: e.location,
      max_weekly_hours: e.max_weekly_hours,
      updated_at: e.updated_at,
    })),
  };
};

export const loadDepartments: Loader = async (db) => {
  const { data, error } = await db.from("departments").select("name, positions(title)").order("name");
  if (error) return null;
  return {
    total: data.length,
    data: data.map((d) => ({ name: d.name, positions: d.positions.map((p) => p.title).sort((a, b) => a.localeCompare(b)) })),
  };
};

export const loadShifts: Loader = async (db, { limit, offset, from, to }) => {
  const start = manilaMidnight(from!);
  const end = manilaMidnight(addDays(to!, 1));
  const total = await db.from("shifts").select("id", { count: "exact", head: true }).eq("status", "published").gte("starts_at", start).lt("starts_at", end);
  if (total.error || total.count === null) return null;
  if (offset >= total.count) return { data: [], total: total.count };

  const { data, error } = await db
    .from("shifts")
    .select("id, title, starts_at, ends_at, required_headcount, department:departments(name), position:positions(title), shift_assignments(employee:employees(employee_code))")
    .eq("status", "published")
    .gte("starts_at", start)
    .lt("starts_at", end)
    .order("starts_at")
    .order("id")
    .range(offset, offset + limit - 1);
  if (error) return null;
  return {
    total: total.count,
    data: data.map((s) => ({
      id: s.id,
      title: s.title,
      starts_at: s.starts_at,
      ends_at: s.ends_at,
      department: s.department?.name ?? null,
      position: s.position?.title ?? null,
      required_headcount: s.required_headcount,
      assigned_employee_codes: s.shift_assignments.flatMap((a) => (a.employee ? [a.employee.employee_code] : [])).sort(),
    })),
  };
};

export const loadAttendance: Loader = async (db, { limit, offset, from, to }) => {
  const total = await db.from("attendance_records").select("id", { count: "exact", head: true }).gte("work_date", from!).lte("work_date", to!);
  if (total.error || total.count === null) return null;
  if (offset >= total.count) return { data: [], total: total.count };

  const { data, error } = await db
    .from("attendance_records")
    .select("work_date, status, clock_in, clock_out, employee:employees(employee_code), assignment:shift_assignments(shift:shifts(starts_at, ends_at))")
    .gte("work_date", from!)
    .lte("work_date", to!)
    .order("work_date")
    .order("id")
    .range(offset, offset + limit - 1);
  if (error) return null;
  return {
    total: total.count,
    data: data.map((r) => {
      const shift = r.assignment?.shift ?? null;
      // The same calculation as the Reports page (lib/attendance-report.ts).
      const row = {
        department: "",
        employeeId: "",
        employeeName: "",
        employeeCode: "",
        status: r.status as AttendanceStatus,
        clockIn: r.clock_in,
        clockOut: r.clock_out,
        scheduledStart: shift?.starts_at ?? "",
        scheduledEnd: shift?.ends_at ?? "",
      };
      return {
        employee_code: r.employee?.employee_code ?? null,
        work_date: r.work_date,
        status: r.status,
        clock_in: r.clock_in,
        clock_out: r.clock_out,
        worked_minutes: workedMinutes(row),
        scheduled_minutes: shift ? Math.round((Date.parse(shift.ends_at) - Date.parse(shift.starts_at)) / 60_000) : null,
        overtime_minutes: shift ? overtimeMinutes(row) : null,
      };
    }),
  };
};
