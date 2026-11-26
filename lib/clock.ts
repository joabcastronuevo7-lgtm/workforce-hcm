// What the time clock should offer right now. Pure (no imports) so the unit tests run it directly.
// These mirror the rules in the clock_in / clock_out database functions; the database is what enforces them.

export const EARLY_MINUTES = 30;
export const OPEN_RECORD_HOURS = 24;

export type ClockShift = { assignmentId: string; startsAt: string; endsAt: string };
export type ClockRecord = { assignmentId: string | null; clockIn: string | null; clockOut: string | null };

export type ClockState<S extends ClockShift> =
  /** Clocked in (within the last 24 hours) and not yet out. `shift` is null if it is not in the list. */
  | { kind: "in"; since: string; shift: S | null }
  /** A shift can be clocked into now. */
  | { kind: "ready"; shift: S }
  /** The next shift that will open, from `opensAt`. */
  | { kind: "wait"; shift: S; opensAt: string }
  | { kind: "none" };

export function clockState<S extends ClockShift>(shifts: readonly S[], records: readonly ClockRecord[], now: Date): ClockState<S> {
  const t = now.getTime();
  const open = records
    .filter((r) => r.clockIn && !r.clockOut && Date.parse(r.clockIn) > t - OPEN_RECORD_HOURS * 3_600_000)
    .sort((a, b) => Date.parse(b.clockIn!) - Date.parse(a.clockIn!))[0];
  if (open) return { kind: "in", since: open.clockIn!, shift: shifts.find((s) => s.assignmentId === open.assignmentId) ?? null };

  const recorded = new Set(records.map((r) => r.assignmentId));
  const pending = shifts
    .filter((s) => !recorded.has(s.assignmentId) && Date.parse(s.endsAt) > t)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const opens = (s: S) => Date.parse(s.startsAt) - EARLY_MINUTES * 60_000;
  // With two shifts open at once, offer the one that started (or starts) latest: it is the one the person is arriving for.
  const ready = pending.filter((s) => opens(s) <= t).at(-1);
  if (ready) return { kind: "ready", shift: ready };
  return pending[0] ? { kind: "wait", shift: pending[0], opensAt: new Date(opens(pending[0])).toISOString() } : { kind: "none" };
}

/** Database error names raised by clock_in / clock_out, in words for the employee. */
export const CLOCK_ERRORS: Record<string, string> = {
  shift_not_found: "That shift is not available to clock in to. Refresh the page.",
  already_recorded: "Attendance is already recorded for that shift.",
  outside_window: `Clock in opens ${EARLY_MINUTES} minutes before the shift starts and closes when it ends.`,
  already_clocked_in: "You are already clocked in. Clock out first.",
  not_clocked_in: "You are not clocked in. If you forgot to clock out more than a day ago, ask your administrator.",
};

export const manilaTime = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
