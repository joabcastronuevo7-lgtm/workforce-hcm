import type { createClient } from "@/lib/supabase/server";
import type { AttendanceRow, AttendanceStatus } from "@/lib/attendance-report";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export const ATTENDANCE_ROW_LIMIT = 1000;

/**
 * Attendance records since `fromDate` (a Manila "YYYY-MM-DD", or null for all time), joined to the shift they belong to.
 * Read-only. A record whose shift assignment was removed has no shift to compare with, so it is counted in `unlinked` and
 * left out of the figures. `truncated` is true when the row limit was reached.
 */
export async function loadAttendanceRows(
  supabase: Supabase,
  fromDate: string | null,
): Promise<{ rows: AttendanceRow[]; unlinked: number; truncated: boolean } | "error"> {
  let query = supabase
    .from("attendance_records")
    .select(
      "status, clock_in, clock_out, work_date, employee:employees(id, employee_code, first_name, last_name, location, hire_date), assignment:shift_assignments(shift:shifts(starts_at, ends_at, department:departments(name)))",
    )
    .order("work_date", { ascending: false })
    .limit(ATTENDANCE_ROW_LIMIT);
  if (fromDate) query = query.gte("work_date", fromDate);

  const { data, error } = await query;
  if (error || !data) return "error";

  const rows: AttendanceRow[] = [];
  let unlinked = 0;
  for (const r of data) {
    const shift = r.assignment?.shift;
    if (!shift || !r.employee) {
      unlinked++;
      continue;
    }
    rows.push({
      department: shift.department?.name ?? "No department",
      employeeId: r.employee.id,
      employeeName: `${r.employee.first_name} ${r.employee.last_name}`,
      employeeCode: r.employee.employee_code,
      status: r.status as AttendanceStatus,
      clockIn: r.clock_in,
      clockOut: r.clock_out,
      scheduledStart: shift.starts_at,
      scheduledEnd: shift.ends_at,
      location: r.employee.location,
      hireDate: r.employee.hire_date,
    });
  }
  return { rows, unlinked, truncated: data.length >= ATTENDANCE_ROW_LIMIT };
}
