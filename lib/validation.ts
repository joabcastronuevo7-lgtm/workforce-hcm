import type { EmployeeStatus, EmploymentType } from "./labels";

// Pure form parsing shared by the employee Server Actions. Kept free of server imports so
// lib/validation.test.ts can run it directly with Node.

export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMPLOYEE_CODE = /^[A-Z0-9][A-Z0-9-]{1,19}$/;
const PHONE = /^\+?[0-9][0-9\s()-]{5,19}$/;
const STATUSES: EmployeeStatus[] = ["active", "on_leave", "inactive"];
const TYPES: EmploymentType[] = ["full_time", "part_time", "contract"];

export type EmployeeInput = {
  employee_code: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  department_id: string;
  position_id: string;
  employment_type: EmploymentType;
  status: EmployeeStatus;
  hire_date: string;
  location: string | null;
};

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function isRealDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

export function parseEmployee(formData: FormData): { data?: EmployeeInput; errors: Record<string, string> } {
  const text = (name: string) => String(formData.get(name) ?? "").trim();
  const errors: Record<string, string> = {};

  const employee_code = text("employee_code").toUpperCase();
  const first_name = text("first_name");
  const last_name = text("last_name");
  const email = text("email").toLowerCase();
  const phone = text("phone");
  const department_id = text("department_id");
  const position_id = text("position_id");
  const employment_type = text("employment_type") as EmploymentType;
  const status = text("status") as EmployeeStatus;
  const hire_date = text("hire_date");
  const location = text("location");

  if (!employee_code) errors.employee_code = "Enter an employee ID.";
  else if (!EMPLOYEE_CODE.test(employee_code))
    errors.employee_code = "Use 2–20 letters, digits or hyphens, for example EMP-0042.";
  if (!first_name) errors.first_name = "Enter a first name.";
  else if (first_name.length > 100) errors.first_name = "Keep it under 100 characters.";
  if (!last_name) errors.last_name = "Enter a last name.";
  else if (last_name.length > 100) errors.last_name = "Keep it under 100 characters.";
  if (!email) errors.email = "Enter an email address.";
  else if (!EMAIL.test(email) || email.length > 254) errors.email = "Enter a valid email address.";
  if (phone && !PHONE.test(phone)) errors.phone = "Enter a valid phone number, for example +63 917 555 0142.";
  if (!isUuid(department_id)) errors.department_id = "Choose a department.";
  if (!isUuid(position_id)) errors.position_id = "Choose a position.";
  if (!TYPES.includes(employment_type)) errors.employment_type = "Choose an employment type.";
  if (!STATUSES.includes(status)) errors.status = "Choose a status.";
  if (!isRealDate(hire_date)) errors.hire_date = "Enter a valid hire date.";
  if (location.length > 60) errors.location = "Keep it under 60 characters.";

  if (Object.keys(errors).length) return { errors };
  return {
    errors,
    data: {
      employee_code,
      first_name,
      last_name,
      email,
      phone: phone || null,
      department_id,
      position_id,
      employment_type,
      status,
      hire_date,
      location: location || null,
    },
  };
}

// ---------------------------------------------------------------------------
// Weekly availability windows
// ---------------------------------------------------------------------------

export type AvailabilityWindow = { day_of_week: number; start_time: string; end_time: string };

const TIME = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

// Policy: a window lies within one day (start < end, both on that day), matching the table's
// CHECK (end_time > start_time). Windows on the same day may touch (09:00–12:00, 12:00–17:00)
// but not overlap. Overnight availability is a window ending at 23:59, which covers a shift that
// starts inside it and finishes the next morning (END_OF_DAY_WINDOW in lib/scheduling.ts, the single
// definition). The "23:59" in the message below is checked against that constant by scripts/scheduling.test.mjs.
export function parseWindow(formData: FormData): { data?: AvailabilityWindow; error?: string } {
  const day = Number(formData.get("day_of_week"));
  const start = String(formData.get("start_time") ?? "").trim();
  const end = String(formData.get("end_time") ?? "").trim();

  if (!Number.isInteger(day) || day < 0 || day > 6) return { error: "Choose a day of the week." };
  if (!TIME.test(start) || !TIME.test(end)) return { error: "Enter start and end times as HH:MM." };
  if (minutes(end) <= minutes(start))
    return {
      error:
        "The end time must be after the start time on the same day. For overnight availability, end the window at 23:59: it then covers a shift that starts inside it and finishes the next morning.",
    };
  return { data: { day_of_week: day, start_time: start.slice(0, 5), end_time: end.slice(0, 5) } };
}

/** Returns an existing window on the same day that overlaps `next`, ignoring the one being edited. */
export function findOverlap<T extends AvailabilityWindow & { id: string }>(
  existing: T[],
  next: AvailabilityWindow,
  ignoreId?: string,
): T | undefined {
  return existing.find(
    (w) =>
      w.id !== ignoreId &&
      w.day_of_week === next.day_of_week &&
      minutes(w.start_time) < minutes(next.end_time) &&
      minutes(next.start_time) < minutes(w.end_time),
  );
}

// Strips characters that carry meaning in PostgREST filter strings (commas, parentheses,
// wildcards, quotes, backslashes) so user search text cannot alter the query's structure.
export function searchTerms(query: string) {
  return query
    .replace(/[,()*%\\"':.]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5);
}
