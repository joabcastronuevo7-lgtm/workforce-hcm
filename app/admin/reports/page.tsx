import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { RequireRole } from "@/components/app-shell";
import { PageHeader } from "@/components/placeholder";
import { Alert, Card, EmptyState, buttonClass } from "@/components/ui";
import { attendanceRate, hoursText, percentText, summarize } from "@/lib/attendance-report";
import { createClient } from "@/lib/supabase/server";
import { addDays, toManilaParts } from "@/lib/scheduling";
import { REPORT_GROUPS, isReportGroup, unitName } from "@/lib/business-units";
import { loadAttendanceRows } from "./attendance-data";

export const metadata: Metadata = { title: "Reports" };

export default function Page({ searchParams }: PageProps<"/admin/reports">) {
  return (
    <RequireRole role="admin">
      <PageHeader title="Reports" description="Attendance and overtime by business unit, from the recorded clock-in and clock-out times." />
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <AttendanceReport searchParams={searchParams} />
      </Suspense>
    </RequireRole>
  );
}

const RANGES = [
  { key: "7", label: "Last 7 days", days: 7 },
  { key: "30", label: "Last 30 days", days: 30 },
  { key: "all", label: "All time", days: null },
] as const;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

async function AttendanceReport({ searchParams }: { searchParams: PageProps<"/admin/reports">["searchParams"] }) {
  const raw = await searchParams;
  const range = RANGES.find((r) => r.key === first(raw.range)) ?? RANGES[1];
  const supabase = await createClient();

  // "now" is read after the request data, so it is never baked into a prerendered shell.
  const today = toManilaParts(new Date()).date;
  const fromDate = range.days ? addDays(today, -range.days) : null;
  const loaded = await loadAttendanceRows(supabase, fromDate);
  if (loaded === "error") return <Alert tone="error">Could not load the attendance records. Refresh the page to try again.</Alert>;

  const groupParam = first(raw.group);
  const group = isReportGroup(groupParam) ? groupParam : "department";
  const unitLabel = REPORT_GROUPS[group];
  // The summary groups by `department`; for the other unit types that field carries the unit name.
  const { departments, total, overtimeLeaders } = summarize(
    loaded.rows.map((row) => ({ ...row, department: unitName(group, { department: row.department, location: row.location ?? null, hireDate: row.hireDate ?? today }, today) })),
  );
  const rate = attendanceRate(total);

  return (
    <div className="space-y-4">
      <nav aria-label="Report period" className="flex flex-wrap gap-2">
        {RANGES.map((r) =>
          r.key === range.key ? (
            <span key={r.key} aria-current="page" className={`${buttonClass.primary} pointer-events-none`}>
              {r.label}
            </span>
          ) : (
            <Link key={r.key} href={`/admin/reports?range=${r.key}&group=${group}`} className={buttonClass.secondary}>
              {r.label}
            </Link>
          ),
        )}
      </nav>

      <nav aria-label="Group by" className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-zinc-500">Group by</span>
        {Object.entries(REPORT_GROUPS).map(([key, label]) =>
          key === group ? (
            <span key={key} aria-current="page" className={`${buttonClass.primary} pointer-events-none`}>
              {label}
            </span>
          ) : (
            <Link key={key} href={`/admin/reports?range=${range.key}&group=${key}`} className={buttonClass.secondary}>
              {label}
            </Link>
          ),
        )}
      </nav>

      {loaded.truncated && <Alert tone="info">Only the {loaded.rows.length + loaded.unlinked} most recent records are included. Choose a shorter period for complete figures.</Alert>}
      {loaded.unlinked > 0 && <Alert tone="info">{loaded.unlinked} record(s) are not linked to a shift any more and are left out.</Alert>}

      {total.records ? (
        <>
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-5" aria-label="Attendance summary">
            <Stat label="Attendance records" value={String(total.records)} note={`${total.present} present · ${total.late} late`} />
            <Stat label="Attendance rate" value={percentText(rate)} note={`${total.absent} absent · ${total.excused} excused`} tone={rate !== null && rate < 0.9 ? "amber" : "green"} />
            <Stat label="Hours worked" value={hoursText(total.workedMin)} note="Clock-out minus clock-in" />
            <Stat label="Overtime hours" value={hoursText(total.overtimeMin)} note={`${total.overtimeRecords} shift(s) with overtime`} tone={total.overtimeMin ? "amber" : undefined} />
            <Stat label="Late arrivals" value={String(total.late)} note={total.stillOpen ? `${total.stillOpen} still clocked in` : "Everyone has clocked out"} />
          </dl>

          <Card title={`By ${unitLabel.toLowerCase()}`}>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm sm:min-w-[640px]">
                <thead className="text-xs text-zinc-500">
                  <tr className="border-b border-zinc-200">
                    <th scope="col" className="px-1 py-2 sm:px-4 font-medium">{unitLabel}</th>
                    <th scope="col" className="hidden sm:table-cell px-1.5 py-2 text-right sm:px-2 font-medium">Records</th>
                    <th scope="col" className="px-1.5 py-2 text-right sm:px-2 font-medium">Late</th>
                    <th scope="col" className="hidden sm:table-cell px-1.5 py-2 text-right sm:px-2 font-medium">Absent</th>
                    <th scope="col" className="hidden sm:table-cell px-1.5 py-2 text-right sm:px-2 font-medium">Excused</th>
                    <th scope="col" className="px-1.5 py-2 text-right font-medium sm:px-2">
                      <span className="sm:hidden" aria-hidden>Rate</span>
                      <span className="sr-only sm:not-sr-only">Attendance</span>
                    </th>
                    <th scope="col" className="hidden sm:table-cell px-1.5 py-2 text-right sm:px-2 font-medium">Worked</th>
                    <th scope="col" className="px-1 py-2 sm:px-4 text-right font-medium">Overtime</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {departments.map((d) => (
                    <tr key={d.department}>
                      <th scope="row" className="px-1 py-2 sm:px-4 font-medium text-zinc-900">
                        {d.department}
                        <span className="block text-xs font-normal text-zinc-500 sm:hidden">
                          {d.records} records · {d.absent} absent · {d.excused} excused · {hoursText(d.workedMin)}
                        </span>
                      </th>
                      <td className="hidden sm:table-cell px-1.5 py-2 text-right sm:px-2 tabular-nums">{d.records}</td>
                      <td className="px-1.5 py-2 text-right sm:px-2 tabular-nums">{d.late}</td>
                      <td className="hidden sm:table-cell px-1.5 py-2 text-right sm:px-2 tabular-nums">{d.absent}</td>
                      <td className="hidden sm:table-cell px-1.5 py-2 text-right sm:px-2 tabular-nums">{d.excused}</td>
                      <td className="px-1.5 py-2 text-right sm:px-2 tabular-nums">{percentText(attendanceRate(d))}</td>
                      <td className="hidden sm:table-cell px-1.5 py-2 text-right sm:px-2 tabular-nums">{hoursText(d.workedMin)}</td>
                      <td className={`px-1 py-2 sm:px-4 text-right tabular-nums ${d.overtimeMin ? "font-medium text-amber-700" : ""}`}>{hoursText(d.overtimeMin)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-zinc-200 font-semibold text-zinc-900">
                    <th scope="row" className="px-1 py-2 sm:px-4">
                      All
                      <span className="block text-xs font-normal text-zinc-500 sm:hidden">
                        {total.records} records · {total.absent} absent · {total.excused} excused · {hoursText(total.workedMin)}
                      </span>
                    </th>
                    <td className="hidden sm:table-cell px-1.5 py-2 text-right sm:px-2 tabular-nums">{total.records}</td>
                    <td className="px-1.5 py-2 text-right sm:px-2 tabular-nums">{total.late}</td>
                    <td className="hidden sm:table-cell px-1.5 py-2 text-right sm:px-2 tabular-nums">{total.absent}</td>
                    <td className="hidden sm:table-cell px-1.5 py-2 text-right sm:px-2 tabular-nums">{total.excused}</td>
                    <td className="px-1.5 py-2 text-right sm:px-2 tabular-nums">{percentText(rate)}</td>
                    <td className="hidden sm:table-cell px-1.5 py-2 text-right sm:px-2 tabular-nums">{hoursText(total.workedMin)}</td>
                    <td className="px-1 py-2 sm:px-4 text-right tabular-nums">{hoursText(total.overtimeMin)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>

          {overtimeLeaders.length > 0 && (
            <Card title="Most overtime">
              <ol className="divide-y divide-zinc-100">
                {overtimeLeaders.map((e) => (
                  <li key={e.employeeId} className="flex items-baseline justify-between gap-3 px-5 py-2 text-sm">
                    <span>
                      <span className="font-medium text-zinc-900">{e.name}</span> <span className="font-mono text-xs text-zinc-500">{e.code}</span>
                    </span>
                    <span className="text-zinc-700">{hoursText(e.overtimeMin)} over {e.records} shift(s)</span>
                  </li>
                ))}
              </ol>
            </Card>
          )}
        </>
      ) : (
        <EmptyState title="No attendance records in this period" description="Try a longer period." />
      )}

      <Card title="How these figures are calculated">
        <ul className="list-disc space-y-1 px-9 py-3 text-sm text-zinc-600">
          <li>Hours worked are the clock-out time minus the clock-in time. Absent and excused records have no clock times.</li>
          <li>Overtime is the time worked beyond the scheduled shift length, never below zero. It compares durations, so arriving early and leaving on time can count.</li>
          <li>The attendance data has no break records, so breaks are not deducted. Worked and scheduled time are both gross.</li>
          <li>Late, absent and excused come from each record&apos;s status. Attendance is present plus late, out of present, late and absent; excused records are left out.</li>
          <li>Divisions come from the shift each record belongs to. Location and tenure come from the employee, with tenure counted to today. Periods use the Asia/Manila date.</li>
        </ul>
      </Card>
    </div>
  );
}

function Stat({ label, value, note, tone }: { label: string; value: string; note: string; tone?: "amber" | "green" }) {
  const color = tone === "amber" ? "text-amber-700" : tone === "green" ? "text-emerald-700" : "text-zinc-900";
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-3">
      <dt className="text-xs font-medium text-zinc-500">{label}</dt>
      <dd className={`mt-1 text-xl font-semibold ${color}`}>{value}</dd>
      <p className="mt-0.5 text-xs text-zinc-500">{note}</p>
    </div>
  );
}
