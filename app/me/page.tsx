import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { Alert, Badge, EmptyState } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { addDays, formatDayHeading, formatTimeRange, toManilaParts, weekBoundsUtc, weekStartManila } from "@/lib/scheduling";

export const metadata: Metadata = { title: "My dashboard" };

const UPCOMING = 4;
const hhmm = (t: string) => t.slice(0, 5);

export default function Page() {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
      <EmployeeDashboard />
    </Suspense>
  );
}

async function EmployeeDashboard() {
  const user = await requireRole("employee");
  const supabase = await createClient();

  // "now" is read after the request data, so it is never baked into a prerendered shell.
  const now = new Date();
  const weekStart = weekStartManila(now);
  const { start, end } = weekBoundsUtc(weekStart);
  const today = toManilaParts(now);

  // Only this person's own rows. RLS limits an employee to their own record, availability, Telegram link and published
  // assigned shifts; the employee_id filters say the same in the query, so the page is correct for any session.
  const { data: me, error: meError } = await supabase.from("employees").select("id, first_name").eq("profile_id", user.id).maybeSingle();
  if (meError) return <Alert tone="error">Could not load your dashboard. Refresh the page to try again.</Alert>;
  if (!me)
    return (
      <EmptyState
        title="Your account is not linked to an employee record yet"
        description="Ask your administrator to link your account. Your shifts will appear here once they do."
      />
    );

  const [{ data, error }, availability, telegram] = await Promise.all([
    supabase
      .from("shift_assignments")
      .select("id, shift:shifts!inner(id, title, starts_at, ends_at, department:departments(name), position:positions(title))")
      .eq("employee_id", me.id)
      .eq("shift.status", "published")
      .gte("shift.starts_at", start.toISOString())
      .lt("shift.starts_at", weekBoundsUtc(addDays(weekStart, 63)).start.toISOString()),
    supabase.from("employee_availability").select("day_of_week, start_time, end_time").eq("employee_id", me.id).order("start_time"),
    supabase.from("employee_telegram").select("employee_id").eq("employee_id", me.id).maybeSingle(),
  ]);

  const shifts = (data ?? []).map((a) => a.shift).sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  const ahead = shifts.filter((s) => Date.parse(s.ends_at) > now.getTime());
  const next = ahead[0];
  const todays = shifts.filter((s) => toManilaParts(s.starts_at).date === today.date);
  const later = ahead.filter((s) => s !== next && toManilaParts(s.starts_at).date !== today.date);
  const thisWeek = shifts.filter((s) => Date.parse(s.starts_at) < end.getTime());
  const hours = thisWeek.reduce((sum, s) => sum + (Date.parse(s.ends_at) - Date.parse(s.starts_at)) / 3_600_000, 0);

  const windows = availability.data ?? [];
  const todayWindows = windows.filter((w) => w.day_of_week === new Date(`${today.date}T00:00:00Z`).getUTCDay());
  const availableDays = new Set(windows.map((w) => w.day_of_week)).size;

  const greeting = today.minutes < 12 * 60 ? "Good morning" : today.minutes < 18 * 60 ? "Good afternoon" : "Good evening";
  const dayLabel = (iso: string) => {
    const date = toManilaParts(iso).date;
    return date === today.date ? "Today" : date === addDays(today.date, 1) ? "Tomorrow" : formatDayHeading(date);
  };
  const started = next && Date.parse(next.starts_at) <= now.getTime();

  return (
    <div className="max-w-2xl space-y-4">
      <header>
        <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">{formatDayHeading(today.date)}</p>
        <h1 className="mt-1 truncate text-2xl font-semibold tracking-tight text-zinc-900">
          {greeting}, {me.first_name}
        </h1>
      </header>

      {error ? (
        <Alert tone="error">Could not load your shifts. Refresh the page to try again.</Alert>
      ) : (
        <>
          <section aria-labelledby="next-shift" className="overflow-hidden rounded-2xl bg-teal-700 text-white shadow-sm">
            <div className="p-5">
              <div className="flex items-center justify-between gap-2">
                <h2 id="next-shift" className="text-sm font-medium text-teal-100">
                  {started ? "Your shift now" : "Your next shift"}
                </h2>
                {next && (
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${started ? "bg-amber-300 text-amber-950" : "bg-white/15 text-white"}`}>
                    {started ? "In progress" : dayLabel(next.starts_at)}
                  </span>
                )}
              </div>
              {next ? (
                <>
                  <p className="mt-3 text-sm font-medium text-teal-100">{formatDayHeading(toManilaParts(next.starts_at).date)}</p>
                  <p className="text-4xl font-semibold tracking-tight">{formatTimeRange(next.starts_at, next.ends_at)}</p>
                  <p className="mt-3 text-base font-medium">{next.title}</p>
                  <p className="text-sm text-teal-100">
                    {next.position?.title ? `${next.position.title} · ` : ""}
                    {next.department?.name ?? "No department"}
                  </p>
                </>
              ) : (
                <>
                  <p className="mt-3 text-2xl font-semibold">None scheduled</p>
                  <p className="mt-1 text-sm text-teal-100">Shifts appear once your administrator publishes the schedule.</p>
                </>
              )}
            </div>
            <Link
              href="/me/schedule"
              className="flex min-h-12 items-center justify-between border-t border-white/15 bg-teal-800/40 px-5 text-sm font-semibold hover:bg-teal-800/70"
            >
              View my schedule
              <Icon name="chevronRight" className="size-4" />
            </Link>
          </section>

          <dl aria-label="This week" className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-zinc-200 bg-white p-4">
              <dt className="text-xs font-medium text-zinc-500">Shifts this week</dt>
              <dd className="mt-1 text-2xl font-semibold text-zinc-900">{thisWeek.length}</dd>
            </div>
            <div className="rounded-2xl border border-zinc-200 bg-white p-4">
              <dt className="text-xs font-medium text-zinc-500">Scheduled hours</dt>
              <dd className="mt-1 text-2xl font-semibold text-zinc-900">{hours.toFixed(1)} h</dd>
            </div>
          </dl>

          <section aria-labelledby="today" className="rounded-2xl border border-zinc-200 bg-white">
            <h2 id="today" className="border-b border-zinc-100 px-4 py-3 text-sm font-semibold text-zinc-900">
              Today
            </h2>
            {todays.length ? (
              <ul className="divide-y divide-zinc-100">
                {todays.map((s) => {
                  const done = Date.parse(s.ends_at) <= now.getTime();
                  const live = !done && Date.parse(s.starts_at) <= now.getTime();
                  return (
                    <li key={s.id} className={`flex items-center justify-between gap-3 px-4 py-3 ${done ? "text-zinc-400" : ""}`}>
                      <div className="min-w-0">
                        <p className={`font-semibold ${done ? "" : "text-zinc-900"}`}>{formatTimeRange(s.starts_at, s.ends_at)}</p>
                        <p className="truncate text-xs text-zinc-500">
                          {s.title} · {s.department?.name ?? "No department"}
                        </p>
                      </div>
                      <Badge tone={done ? "zinc" : live ? "amber" : "teal"}>{done ? "Completed" : live ? "In progress" : "Upcoming"}</Badge>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="px-4 py-3 text-sm text-zinc-500">No shift today.</p>
            )}
          </section>

          {later.length > 0 && (
            <section aria-labelledby="upcoming">
              <h2 id="upcoming" className="mb-2 px-1 text-sm font-semibold text-zinc-900">
                Coming up
              </h2>
              <ul className="space-y-2">
                {later.slice(0, UPCOMING).map((s) => (
                  <li key={s.id}>
                    <Link
                      href={`/me/schedule?week=${weekStartManila(s.starts_at)}`}
                      className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-4 hover:border-teal-600/50 active:bg-zinc-50"
                    >
                      <span className="grid w-12 shrink-0 text-center">
                        <span className="text-[11px] font-semibold text-teal-700 uppercase">{formatDayHeading(toManilaParts(s.starts_at).date).split(" ")[0]}</span>
                        <span className="text-xl leading-6 font-semibold text-zinc-900">{Number(toManilaParts(s.starts_at).date.slice(8, 10))}</span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold text-zinc-900">{formatTimeRange(s.starts_at, s.ends_at)}</span>
                        <span className="block truncate text-xs text-zinc-500">
                          {s.title} · {s.department?.name ?? "No department"}
                        </span>
                      </span>
                      <Icon name="chevronRight" className="size-4 text-zinc-300" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Link href="/me/availability" className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-4 hover:border-teal-600/50 active:bg-zinc-50">
          <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-xl bg-teal-50 text-teal-700">
            <Icon name="clock" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-zinc-900">Availability</span>
            <span className="block truncate text-xs text-zinc-500">
              {availability.error
                ? "Could not load"
                : !windows.length
                  ? "None set yet"
                  : todayWindows.length
                    ? `Today ${todayWindows.map((w) => `${hhmm(w.start_time)}–${hhmm(w.end_time)}`).join(", ")}`
                    : `Not available today · ${availableDays} day(s) a week`}
            </span>
          </span>
          <Icon name="chevronRight" className="size-4 text-zinc-300" />
        </Link>
        <Link href="/me/telegram" className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-4 hover:border-teal-600/50 active:bg-zinc-50">
          <span
            aria-hidden
            className={`grid size-10 shrink-0 place-items-center rounded-xl ${telegram.data ? "bg-teal-50 text-teal-700" : "bg-amber-50 text-amber-600"}`}
          >
            <Icon name="send" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-zinc-900">Shift reminders</span>
            <span className="block truncate text-xs text-zinc-500">
              {telegram.error ? "Could not check Telegram" : telegram.data ? "Telegram connected" : "Connect Telegram to get them"}
            </span>
          </span>
          <Icon name="chevronRight" className="size-4 text-zinc-300" />
        </Link>
      </div>
    </div>
  );
}
