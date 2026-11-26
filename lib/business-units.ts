// Business units: division (the department), geography (employees.location) and tenure (from the hire date).
// Pure (no imports) so the unit tests run it directly. Dates are "YYYY-MM-DD" in the organisation's timezone.

export const TENURE_BANDS = { under_1: "Under 1 year", "1_to_3": "1 to 3 years", over_3: "3 years or more" } as const;
export type TenureBand = keyof typeof TENURE_BANDS;

export const isTenureBand = (value: unknown): value is TenureBand => typeof value === "string" && Object.hasOwn(TENURE_BANDS, value);

/** The same calendar day `years` earlier (29 February becomes 28 February). */
export function yearsBefore(date: string, years: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y - years, m, 0)).getUTCDate();
  return `${y - years}-${String(m).padStart(2, "0")}-${String(Math.min(d, lastDay)).padStart(2, "0")}`;
}

/** The band on `today`. The first anniversary starts "1 to 3 years"; the third starts "3 years or more". */
export function tenureBand(hireDate: string, today: string): TenureBand {
  if (hireDate > yearsBefore(today, 1)) return "under_1";
  return hireDate > yearsBefore(today, 3) ? "1_to_3" : "over_3";
}

/** The hire dates in a band, for a database filter: after `after` (exclusive), up to `upTo` (inclusive). */
export function tenureRange(band: TenureBand, today: string): { after?: string; upTo?: string } {
  if (band === "under_1") return { after: yearsBefore(today, 1) };
  if (band === "over_3") return { upTo: yearsBefore(today, 3) };
  return { after: yearsBefore(today, 3), upTo: yearsBefore(today, 1) };
}

export const REPORT_GROUPS = { department: "Division", location: "Location", tenure: "Tenure" } as const;
export type ReportGroup = keyof typeof REPORT_GROUPS;
export const isReportGroup = (value: unknown): value is ReportGroup => typeof value === "string" && Object.hasOwn(REPORT_GROUPS, value);

export const NO_LOCATION = "No location set";

export function unitName(group: ReportGroup, row: { department: string; location: string | null; hireDate: string }, today: string): string {
  if (group === "location") return row.location ?? NO_LOCATION;
  if (group === "tenure") return TENURE_BANDS[tenureBand(row.hireDate, today)];
  return row.department;
}
