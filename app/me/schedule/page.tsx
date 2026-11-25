import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { PageHeader } from "@/components/placeholder";
import { Alert, Badge, EmptyState, buttonClass } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { addDays, formatDayHeading, formatTimeRange, resolveWeek, shiftsByDay, toManilaParts, weekBoundsUtc, weekRangeLabel } from "@/lib/scheduling";

export const metadata: Metadata = { title: "My schedule" };

export default function Page({ searchParams }: PageProps<"/me/schedule">) {
  return (
    <>
      <PageHeader title="My schedule" description="Your published shifts, in Philippine time (Asia/Manila)." />
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <MySchedule searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const hoursOf = (s: { starts_at: string; ends_at: string }) => (Date.parse(s.ends_at) - Date.parse(s.starts_at)) / 3_600_000;
const iconButton =
  "grid size-11 shrink-0 place-items-center rounded-lg border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 active:bg-zinc-100 md:size-10";

async function MySchedule({ searchParams }: { searchParams: PageProps<"/me/schedule">["searchParams"] }) {
  const raw = await searchParams;
  const user = await requireRole("employee");
  const supabase = await createClient();

  // "now" is read after the request data, so it is never baked into a prerendered shell.
  const now = new Date();
  const { weekStart, currentWeek, invalid } = resolveWeek(first(raw.week), now);
  const { start, end } = weekBoundsUtc(weekStart);
  const href = (week: string | null) => (week ? `/me/schedule?week=${week}` : "/me/schedule");

  // Only this person's own assignments. RLS already limits an employee to their own published shifts; the filters below say
  // the same thing in the query, so the page is correct for any session and a draft or cancelled shift can never be listed.
  const { data: me, error: meError } = await supabase.from("employees").select("id").eq("profile_id", user.id).maybeSingle();
  if (meError) return <Alert tone="error">Could not load your schedule. Refresh the page to try again.</Alert>;
  if (!me)
    return (
      <EmptyState
        title="Your account is not linked to an employee record yet"
        description="Ask your administrator to link your account. Your schedule will appear here once they do."
      />
    );

  const { data, error } = await supabase
    .from("shift_assignments")
    .select("id, shift:shifts!inner(id, title, starts_at, ends_at, status, department:departments(name), position:positions(title))")
    .eq("employee_id", me.id)
    .eq("shift.status", "published")
    .gte("shift.starts_at", start.toISOString())
    .lt("shift.starts_at", end.toISOString());
  if (error) return <Alert tone="error">Could not load your schedule. Refresh the page to try again.</Alert>;

  const shifts = data.map((a) => a.shift).sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  const days = [...shiftsByDay(shifts, weekStart)];
  const today = toManilaParts(now).date;
  const totalHours = shifts.reduce((sum, s) => sum + hoursOf(s), 0);
  const remaining = shifts.filter((s) => Date.parse(s.ends_at) > now.getTime()).length;

  return (
    <div className="max-w-2xl space-y-4">
      <nav aria-label="Week navigation" className="flex items-center gap-1">
        <Link href={href(addDays(weekStart, -7))} aria-label="Previous week" className={iconButton}>
          <Icon name="chevronLeft" />
        </Link>
        <div className="min-w-0 flex-1 px-1 text-center">
          <h2 className="truncate text-base font-semibold text-zinc-900">{weekRangeLabel(weekStart)}</h2>
          <p className="truncate text-xs text-zinc-500">
            {weekStart === currentWeek ? (
              "This week"
            ) : (
              <>
                {weekStart > currentWeek ? "A future week" : "A past week"} ·{" "}
                <Link href={href(null)} className="font-medium text-teal-700 underline-offset-2 hover:underline">
                  Back to this week
                </Link>
              </>
            )}
          </p>
        </div>
        <Link href={href(addDays(weekStart, 7))} aria-label="Next week" className={iconButton}>
          <Icon name="chevronRight" />
        </Link>
      </nav>

      {invalid && <Alert tone="info">That week is not a valid date, so the current week is shown.</Alert>}

      {/* Day strip: each day jumps to its row below; a dot marks a working day. */}
      <ol aria-label="Days this week" className="grid grid-cols-7 gap-1 rounded-xl border border-zinc-200 bg-white p-1">
        {days.map(([date, list]) => (
          <li key={date}>
            <a
              href={`#day-${date}`}
              aria-label={`${formatDayHeading(date)}${list.length ? `, ${list.length} shift(s)` : ", day off"}`}
              className={`flex min-h-14 flex-col items-center justify-center rounded-lg text-xs ${
                date === today ? "bg-teal-700 text-white" : "text-zinc-600 active:bg-zinc-100"
              }`}
            >
              <span className={date === today ? "text-teal-100" : ""}>{formatDayHeading(date).split(" ")[0]}</span>
              <span className="text-base leading-5 font-semibold">{Number(date.slice(8, 10))}</span>
              <span aria-hidden className={`mt-0.5 size-1.5 rounded-full ${list.length ? (date === today ? "bg-white" : "bg-teal-600") : "bg-transparent"}`} />
            </a>
          </li>
        ))}
      </ol>

      <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-zinc-200 bg-zinc-200" aria-label="Week summary">
        {[
          ["Shifts", String(shifts.length)],
          ["Hours", `${totalHours.toFixed(1)} h`],
          ["Still ahead", String(remaining)],
        ].map(([label, value]) => (
          <div key={label} className="bg-white px-3 py-2.5">
            <dt className="text-xs font-medium text-zinc-500">{label}</dt>
            <dd className="mt-0.5 text-lg font-semibold text-zinc-900">{value}</dd>
          </div>
        ))}
      </dl>

      {shifts.length ? (
        <ol className="space-y-3">
          {days.map(([date, list]) => (
            <li key={date} id={`day-${date}`} className="scroll-mt-20 md:scroll-mt-6">
              <h3
                className={`flex items-center gap-2 px-1 text-sm font-semibold ${list.length ? "mb-1.5 text-zinc-900" : "text-zinc-400"}`}
              >
                {formatDayHeading(date)}
                {date === today && <Badge tone="teal">Today</Badge>}
                {!list.length && <span className="ml-auto text-xs font-normal">Day off</span>}
              </h3>
              {list.length > 0 && (
                <ul className="space-y-2">
                  {list.map((s) => {
                    const done = Date.parse(s.ends_at) <= now.getTime();
                    const live = !done && Date.parse(s.starts_at) <= now.getTime();
                    return (
                      <li
                        key={s.id}
                        className={`relative overflow-hidden rounded-xl border bg-white py-3 pr-4 pl-5 before:absolute before:inset-y-0 before:left-0 before:w-1 ${
                          done ? "border-zinc-200 before:bg-zinc-300" : live ? "border-amber-300 before:bg-amber-500" : "border-zinc-200 before:bg-teal-600"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <p className={`text-lg font-semibold ${done ? "text-zinc-400" : "text-zinc-900"}`}>{formatTimeRange(s.starts_at, s.ends_at)}</p>
                          <Badge tone={done ? "zinc" : live ? "amber" : "teal"}>{done ? "Completed" : live ? "In progress" : "Upcoming"}</Badge>
                        </div>
                        <p className={`text-sm ${done ? "text-zinc-500" : "text-zinc-800"}`}>{s.title}</p>
                        <p className="text-xs text-zinc-500">
                          {s.position ? `${s.position.title} · ` : ""}
                          {s.department?.name ?? "No department"} · {hoursOf(s).toFixed(1)} h
                        </p>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <EmptyState
          title="No shifts this week"
          description="Shifts appear here once your administrator publishes the schedule. Try another week."
          action={
            weekStart !== currentWeek ? (
              <Link href={href(null)} className={buttonClass.secondary}>
                This week
              </Link>
            ) : undefined
          }
        />
      )}
    </div>
  );
}
