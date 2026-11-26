import { Suspense } from "react";
import type { Metadata } from "next";
import { PageHeader } from "@/components/placeholder";
import { Alert, Badge, EmptyState } from "@/components/ui";
import { hoursText, workedMinutes } from "@/lib/attendance-report";
import { requireRole } from "@/lib/auth";
import { OPEN_RECORD_HOURS, manilaTime } from "@/lib/clock";
import { formatDayHeading, formatTimeRange } from "@/lib/scheduling";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Attendance" };

const LIMIT = 60;
const TONES = { present: "green", late: "amber", absent: "red", excused: "zinc" } as const;
const LABELS = { present: "On time", late: "Late", absent: "Absent", excused: "Excused" } as const;

export default function Page() {
  return (
    <>
      <PageHeader title="Attendance" description="Your clock-in and clock-out history, in Philippine time (Asia/Manila)." />
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <History />
      </Suspense>
    </>
  );
}

async function History() {
  const user = await requireRole("employee");
  const supabase = await createClient();
  const failed = <Alert tone="error">Could not load your attendance. Refresh the page to try again.</Alert>;

  // Own rows only: RLS says so, and the employee_id filter keeps the query correct for any session.
  const { data: me, error: meError } = await supabase.from("employees").select("id").eq("profile_id", user.id).maybeSingle();
  if (meError) return failed;
  if (!me)
    return <EmptyState title="Your account is not linked to an employee record yet" description="Ask your administrator to link your account first." />;

  const { data, error } = await supabase
    .from("attendance_records")
    .select("id, work_date, clock_in, clock_out, status, assignment:shift_assignments(shift:shifts(title, starts_at, ends_at))")
    .eq("employee_id", me.id)
    .order("work_date", { ascending: false })
    .order("clock_in", { ascending: false })
    .limit(LIMIT);
  if (error) return failed;
  if (!data.length)
    return <EmptyState title="No attendance yet" description="Your records appear here after you clock in from the dashboard." />;

  const now = new Date();
  const worked = data.map((r) => workedMinutes({ clockIn: r.clock_in, clockOut: r.clock_out }));
  const totalMin = worked.reduce<number>((sum, m) => sum + (m ?? 0), 0);

  return (
    <div className="max-w-2xl space-y-4">
      <dl aria-label="Totals" className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-zinc-200 bg-zinc-200">
        {[
          ["Records", String(data.length)],
          ["Hours worked", hoursText(totalMin)],
          ["Late", String(data.filter((r) => r.status === "late").length)],
        ].map(([label, value]) => (
          <div key={label} className="bg-white px-3 py-2.5">
            <dt className="text-xs font-medium text-zinc-500">{label}</dt>
            <dd className="mt-0.5 text-lg font-semibold text-zinc-900">{value}</dd>
          </div>
        ))}
      </dl>

      <ul className="space-y-2">
        {data.map((r, i) => {
          const shift = r.assignment?.shift;
          const minutes = worked[i];
          const open = Boolean(r.clock_in && !r.clock_out);
          const stale = open && Date.parse(r.clock_in!) <= now.getTime() - OPEN_RECORD_HOURS * 3_600_000;
          return (
            <li key={r.id} className="rounded-xl border border-zinc-200 bg-white p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-zinc-900">{formatDayHeading(r.work_date)}</h2>
                <span className="flex gap-1.5">
                  {open && <Badge tone={stale ? "red" : "teal"}>{stale ? "No clock-out" : "Clocked in"}</Badge>}
                  <Badge tone={TONES[r.status]}>{LABELS[r.status]}</Badge>
                </span>
              </div>
              <dl className="mt-2 grid grid-cols-3 gap-2 text-sm">
                {[
                  ["In", r.clock_in ? manilaTime(r.clock_in) : "—"],
                  ["Out", r.clock_out ? manilaTime(r.clock_out) : "—"],
                  ["Worked", minutes === null ? "—" : `${Math.floor(minutes / 60)} h ${minutes % 60} m`],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-xs text-zinc-500">{label}</dt>
                    <dd className="font-semibold text-zinc-900">{value}</dd>
                  </div>
                ))}
              </dl>
              {shift && (
                <p className="mt-2 text-xs text-zinc-500">
                  {shift.title} · scheduled {formatTimeRange(shift.starts_at, shift.ends_at)}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {data.length === LIMIT && <p className="px-1 text-xs text-zinc-500">Showing your {LIMIT} most recent records.</p>}
    </div>
  );
}
