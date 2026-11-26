// Attendance and overtime figures. Pure functions (no imports) so the unit tests can run them directly.
//
// How the numbers are calculated (also shown on the Reports page):
// - Worked time = clock_out minus clock_in, in whole minutes. A record without both clock times (absent, excused, or someone
//   still clocked in) has no worked time.
// - Overtime = worked time beyond the scheduled shift length (ends_at minus starts_at), never below zero. It is a duration
//   comparison, so clocking in early and out on time can count as overtime.
// - The attendance data has NO break columns, so breaks cannot be deducted. Worked and scheduled time are both gross, which
//   keeps the comparison consistent.
// - Late, absent and excused come from the record's status. Attendance rate = (present + late) / (present + late + absent);
//   excused records are left out of the rate.

export type AttendanceStatus = "present" | "late" | "absent" | "excused";

export type AttendanceRow = {
  department: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  status: AttendanceStatus;
  clockIn: string | null;
  clockOut: string | null;
  scheduledStart: string;
  scheduledEnd: string;
  /** For grouping by business unit. */
  location?: string | null;
  hireDate?: string;
};

export type AttendanceTotals = {
  records: number;
  present: number;
  late: number;
  absent: number;
  excused: number;
  workedMin: number;
  overtimeMin: number;
  /** Records with some overtime. */
  overtimeRecords: number;
  /** Present or late records with no clock-out yet. */
  stillOpen: number;
};

export type DepartmentSummary = AttendanceTotals & { department: string };
export type OvertimeLeader = { employeeId: string; name: string; code: string; overtimeMin: number; records: number };

const ms = (iso: string) => Date.parse(iso);

export function workedMinutes(row: Pick<AttendanceRow, "clockIn" | "clockOut">): number | null {
  if (!row.clockIn || !row.clockOut) return null;
  const diff = ms(row.clockOut) - ms(row.clockIn);
  return Number.isFinite(diff) && diff > 0 ? Math.round(diff / 60_000) : null;
}

export function overtimeMinutes(row: AttendanceRow): number {
  const worked = workedMinutes(row);
  if (worked === null) return 0;
  const scheduled = Math.round((ms(row.scheduledEnd) - ms(row.scheduledStart)) / 60_000);
  return Math.max(0, worked - scheduled);
}

const emptyTotals = (): AttendanceTotals => ({ records: 0, present: 0, late: 0, absent: 0, excused: 0, workedMin: 0, overtimeMin: 0, overtimeRecords: 0, stillOpen: 0 });

function add(t: AttendanceTotals, row: AttendanceRow) {
  t.records++;
  t[row.status]++;
  const worked = workedMinutes(row);
  if (worked !== null) t.workedMin += worked;
  else if ((row.status === "present" || row.status === "late") && !row.clockOut) t.stillOpen++;
  const ot = overtimeMinutes(row);
  t.overtimeMin += ot;
  if (ot > 0) t.overtimeRecords++;
}

/** Share of expected shifts attended, or null when there is nothing to measure. Excused records are not counted. */
export function attendanceRate(t: Pick<AttendanceTotals, "present" | "late" | "absent">): number | null {
  const expected = t.present + t.late + t.absent;
  return expected ? (t.present + t.late) / expected : null;
}

export function summarize(rows: AttendanceRow[], leaders = 5): { departments: DepartmentSummary[]; total: AttendanceTotals; overtimeLeaders: OvertimeLeader[] } {
  const total = emptyTotals();
  const byDepartment = new Map<string, DepartmentSummary>();
  const byEmployee = new Map<string, OvertimeLeader>();
  for (const row of rows) {
    add(total, row);
    let d = byDepartment.get(row.department);
    if (!d) byDepartment.set(row.department, (d = { department: row.department, ...emptyTotals() }));
    add(d, row);
    const ot = overtimeMinutes(row);
    if (ot > 0) {
      const e = byEmployee.get(row.employeeId) ?? { employeeId: row.employeeId, name: row.employeeName, code: row.employeeCode, overtimeMin: 0, records: 0 };
      e.overtimeMin += ot;
      e.records++;
      byEmployee.set(row.employeeId, e);
    }
  }
  return {
    departments: [...byDepartment.values()].sort((a, b) => a.department.localeCompare(b.department)),
    total,
    overtimeLeaders: [...byEmployee.values()].sort((a, b) => b.overtimeMin - a.overtimeMin || a.code.localeCompare(b.code)).slice(0, leaders),
  };
}

export const hoursText = (min: number) => `${(min / 60).toFixed(1)} h`;
export const percentText = (share: number | null) => (share === null ? "—" : `${Math.round(share * 100)}%`);
