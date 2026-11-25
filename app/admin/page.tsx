import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/placeholder";
import { RequireRole } from "@/components/app-shell";
import { Icon, type IconName } from "@/components/icons";
import { Alert, Badge } from "@/components/ui";
import { hoursText, summarize } from "@/lib/attendance-report";
import { createClient } from "@/lib/supabase/server";
import {
  addDays,
  formatDayHeading,
  formatTimeRange,
  headcountState,
  shiftsByDay,
  toManilaParts,
  weekBoundsUtc,
  weekRangeLabel,
  weekStartManila,
} from "@/lib/scheduling";
import { loadAttendanceRows } from "./reports/attendance-data";

export const metadata: Metadata = { title: "Dashboard" };

const ALERTS_SHOWN = 5;

export default function AdminDashboard() {
  return (
    <RequireRole role="admin">
      <PageHeader title="Dashboard" description="This week's staffing, with attendance and overtime for the last 30 days." />
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <Figures />
      </Suspense>
    </RequireRole>
  );
}

const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);

async function Figures() {
  const supabase = await createClient();

  // "now" is read after the request-bound work starts, so it is never baked into a prerendered shell.
  const now = new Date();
  const weekStart = weekStartManila(now);
  const { start, end } = weekBoundsUtc(weekStart);
  const today = toManilaParts(now).date;

  const [employees, shifts, attendance] = await Promise.all([
    supabase.from("employees").select("id", { count: "exact", head: true }).eq("status", "active"),
    // Same rows as before; the extra display columns (title, times, department) name the shifts in the alerts.
    supabase
      .from("shifts")
      .select("id, title, starts_at, ends_at, status, required_headcount, department:departments(name), assignments:shift_assignments(count)")
      .gte("starts_at", start.toISOString())
      .lt("starts_at", end.toISOString())
      .order("starts_at"),
    loadAttendanceRows(supabase, addDays(today, -30)),
  ]);

  if (employees.error || shifts.error || !shifts.data || attendance === "error")
    return <Alert tone="error">Could not load the dashboard figures. Refresh the page to try again.</Alert>;

  const live = shifts.data
    .filter((s) => s.status !== "cancelled")
    .map((s) => ({ ...s, assigned: s.assignments[0]?.count ?? 0 }));
  const isShort = (s: (typeof live)[number]) => ["unfilled", "under"].includes(headcountState(s.assigned, s.required_headcount, s.status));
  const shortShifts = live.filter(isShort);
  const draft = live.filter((s) => s.status === "draft").length;
  const required = live.reduce((sum, s) => sum + s.required_headcount, 0);
  const filled = live.reduce((sum, s) => sum + Math.min(s.assigned, s.required_headcount), 0);
  const { total } = summarize(attendance.rows);

  // Alerts: understaffed shifts that have not ended yet, soonest first.
  const upcomingShort = shortShifts.filter((s) => Date.parse(s.ends_at) > now.getTime());
  const days = [...shiftsByDay(live, weekStart)].map(([date, list]) => ({
    date,
    heading: formatDayHeading(date),
    required: list.reduce((sum, s) => sum + s.required_headcount, 0),
    filled: list.reduce((sum, s) => sum + Math.min(s.assigned, s.required_headcount), 0),
    short: list.filter(isShort).length,
  }));

  const kpis: { label: string; value: string; note: string; href: string; icon: IconName; tone?: "amber" | "green" }[] = [
    { label: "Active employees", value: String(employees.count ?? 0), note: "Currently employed", href: "/admin/employees", icon: "users" },
    {
      label: "Shifts this week",
      value: String(live.length),
      note: draft ? `${draft} still in draft` : "All published",
      href: "/admin/schedules",
      icon: "calendar",
      tone: draft ? "amber" : undefined,
    },
    {
      label: "Understaffed",
      value: String(shortShifts.length),
      note: shortShifts.length ? `This week · ${upcomingShort.length} still ahead` : "Every shift is covered",
      href: "/admin/schedules",
      icon: "alert",
      tone: shortShifts.length ? "amber" : "green",
    },
    {
      label: "Overtime",
      value: hoursText(total.overtimeMin),
      note: `Last 30 days · ${total.late} late`,
      href: "/admin/reports",
      icon: "clock",
      tone: total.overtimeMin ? "amber" : undefined,
    },
  ];

  const actions: { label: string; href: string; icon: IconName; primary?: boolean }[] = [
    { label: "New shift", href: `/admin/schedules/new?date=${today}`, icon: "plus", primary: true },
    { label: "Auto-schedule", href: `/admin/schedules/auto?week=${weekStart}`, icon: "sparkle" },
    { label: "Add employee", href: "/admin/employees/new", icon: "userPlus" },
    { label: "Reports", href: "/admin/reports", icon: "chart" },
  ];

  return (
    <div className="space-y-4 md:space-y-6">
      <dl aria-label="Overview" className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        {kpis.map((k) => (
          <Link
            key={k.label}
            href={k.href}
            className="group rounded-xl border border-zinc-200 bg-white p-3.5 shadow-xs transition-colors hover:border-teal-600/50 active:bg-zinc-50 md:p-5"
          >
            <div className="flex items-center justify-between gap-2">
              <dt className="text-xs font-medium text-zinc-500 md:text-sm">{k.label}</dt>
              <Icon name={k.icon} className="size-4 text-zinc-400 group-hover:text-teal-700 md:size-5" />
            </div>
            <dd
              className={`mt-1.5 text-2xl font-semibold tracking-tight md:text-3xl ${
                k.tone === "amber" ? "text-amber-700" : k.tone === "green" ? "text-emerald-700" : "text-zinc-900"
              }`}
            >
              {k.value}
            </dd>
            <p className="mt-0.5 truncate text-xs text-zinc-500">{k.note}</p>
          </Link>
        ))}
      </dl>

      {/* grid-cols-1 (minmax(0, 1fr)): long, truncated alert rows must not widen the single phone column. */}
      <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-4 md:space-y-6 lg:col-span-2">
          <section aria-labelledby="alerts" className="rounded-xl border border-zinc-200 bg-white shadow-xs">
            <header className="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3 md:px-5">
              <h2 id="alerts" className="text-sm font-semibold text-zinc-900">
                Staffing alerts
              </h2>
              {upcomingShort.length > 0 && <Badge tone="amber">{upcomingShort.length} open</Badge>}
            </header>
            {upcomingShort.length || draft ? (
              <ul className="divide-y divide-zinc-100">
                {upcomingShort.slice(0, ALERTS_SHOWN).map((s) => (
                  <li key={s.id}>
                    <Link href={`/admin/schedules/${s.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-50 active:bg-zinc-50 md:px-5">
                      <span
                        aria-hidden
                        className={`grid size-9 shrink-0 place-items-center rounded-lg ${s.assigned === 0 ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-600"}`}
                      >
                        <Icon name="alert" className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-zinc-900">{s.title}</span>
                        <span className="block truncate text-xs text-zinc-500">
                          {toManilaParts(s.starts_at).date === today ? "Today" : formatDayHeading(toManilaParts(s.starts_at).date)} ·{" "}
                          {formatTimeRange(s.starts_at, s.ends_at)} · {s.department?.name ?? "No department"}
                        </span>
                      </span>
                      <Badge tone={s.assigned === 0 ? "red" : "amber"}>
                        {s.assigned}/{s.required_headcount}
                        <span className="sr-only"> assigned</span>
                      </Badge>
                      <Icon name="chevronRight" className="size-4 text-zinc-300" />
                    </Link>
                  </li>
                ))}
                {upcomingShort.length > ALERTS_SHOWN && (
                  <li>
                    <Link href="/admin/schedules" className="block px-4 py-3 text-sm font-medium text-teal-700 hover:bg-zinc-50 md:px-5">
                      {upcomingShort.length - ALERTS_SHOWN} more understaffed shift(s) in Schedules
                    </Link>
                  </li>
                )}
                {draft > 0 && (
                  <li>
                    <Link href="/admin/schedules" className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-50 md:px-5">
                      <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-lg bg-zinc-100 text-zinc-500">
                        <Icon name="calendar" className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1 text-sm text-zinc-800">
                        {draft} shift(s) this week are still drafts. Employees cannot see them until they are published.
                      </span>
                      <Icon name="chevronRight" className="size-4 text-zinc-300" />
                    </Link>
                  </li>
                )}
              </ul>
            ) : (
              <p className="px-4 py-6 text-sm text-zinc-500 md:px-5">No open staffing problems this week. Every remaining shift is covered and published.</p>
            )}
          </section>

          <section aria-labelledby="staffing" className="rounded-xl border border-zinc-200 bg-white p-4 shadow-xs md:p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h2 id="staffing" className="text-sm font-semibold text-zinc-900">
                Staffing this week
              </h2>
              <Link href="/admin/schedules" className="text-xs font-medium text-teal-700 hover:underline">
                {weekRangeLabel(weekStart)}
              </Link>
            </div>
            <p className="mt-3 flex items-baseline gap-2">
              <span className="text-3xl font-semibold tracking-tight text-zinc-900">{pct(filled, required)}%</span>
              <span className="text-sm text-zinc-500">
                of required positions filled · {filled}/{required}
              </span>
            </p>
            <div
              role="img"
              aria-label={`${filled} of ${required} required positions filled`}
              className="mt-2 h-2.5 overflow-hidden rounded-full bg-zinc-100"
            >
              <div className={`h-full rounded-full ${filled < required ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${pct(filled, required)}%` }} />
            </div>

            <ul aria-label="Positions filled by day" className="mt-5 grid grid-cols-7 gap-1.5 sm:gap-3">
              {days.map((d) => (
                <li key={d.date} className="flex flex-col items-center gap-1.5">
                  <span className={`text-[11px] font-semibold ${d.short ? "text-amber-700" : "text-zinc-500"}`}>
                    {d.required ? `${pct(d.filled, d.required)}%` : "–"}
                  </span>
                  <div className="relative h-24 w-full max-w-10 overflow-hidden rounded-md bg-zinc-100" aria-hidden>
                    <div
                      className={`absolute inset-x-0 bottom-0 rounded-md ${d.short ? "bg-amber-400" : "bg-teal-600"}`}
                      style={{ height: `${pct(d.filled, d.required)}%` }}
                    />
                  </div>
                  <span className={`text-xs ${d.date === today ? "font-semibold text-teal-700" : "text-zinc-500"}`}>{d.heading.split(" ")[0]}</span>
                  <span className="sr-only">
                    {d.heading}: {d.filled} of {d.required} filled{d.short ? `, ${d.short} shift(s) short` : ""}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="size-2.5 rounded-sm bg-teal-600" /> Fully staffed day
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="size-2.5 rounded-sm bg-amber-400" /> Day with short shifts
              </span>
            </p>
          </section>
        </div>

        <section aria-labelledby="actions" className="h-fit rounded-xl border border-zinc-200 bg-white p-4 shadow-xs md:p-5">
          <h2 id="actions" className="text-sm font-semibold text-zinc-900">
            Quick actions
          </h2>
          <ul className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-1">
            {actions.map((a) => (
              <li key={a.label}>
                <Link
                  href={a.href}
                  className={`flex min-h-12 items-center gap-2.5 rounded-lg border px-3 text-sm font-medium transition-colors ${
                    a.primary ? "border-teal-700 bg-teal-700 text-white hover:bg-teal-800" : "border-zinc-200 text-zinc-800 hover:bg-zinc-50 active:bg-zinc-100"
                  }`}
                >
                  <Icon name={a.icon} className="size-4" />
                  {a.label}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
