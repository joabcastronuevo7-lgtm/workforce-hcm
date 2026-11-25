import { Suspense } from "react";
import type { Metadata } from "next";
import { PageHeader } from "@/components/placeholder";
import { Alert, Badge, EmptyState } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { DAY_LABELS } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Availability" };

// Monday first, like the schedule. day_of_week: 0 = Sunday … 6 = Saturday.
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const hhmm = (t: string) => t.slice(0, 5);

export default function Page() {
  return (
    <>
      <PageHeader title="Availability" description="When you can work each week. Your administrator schedules you within these times." />
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <MyAvailability />
      </Suspense>
    </>
  );
}

// Read-only view of the employee's own weekly windows. Changes are made by an administrator (employee editing is not built).
async function MyAvailability() {
  const user = await requireRole("employee");
  const supabase = await createClient();
  const { data: me, error: meError } = await supabase.from("employees").select("id").eq("profile_id", user.id).maybeSingle();
  if (meError) return <Alert tone="error">Could not load your availability. Refresh the page to try again.</Alert>;
  if (!me)
    return <EmptyState title="Your account is not linked to an employee record yet" description="Ask your administrator to link your account first." />;

  const { data, error } = await supabase.from("employee_availability").select("id, day_of_week, start_time, end_time").eq("employee_id", me.id).order("start_time");
  if (error) return <Alert tone="error">Could not load your availability. Refresh the page to try again.</Alert>;
  const today = new Date(`${new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" })}T00:00:00Z`).getUTCDay();

  return (
    <div className="max-w-2xl space-y-4">
      {data.length ? (
        <ul className="divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 bg-white">
          {WEEK_ORDER.map((day) => {
            const windows = data.filter((w) => w.day_of_week === day);
            return (
              <li key={day} className="flex min-h-14 items-center justify-between gap-3 px-4 py-2.5">
                <span className="flex items-center gap-2 text-sm font-medium text-zinc-800">
                  {DAY_LABELS[day]}
                  {day === today && <Badge tone="teal">Today</Badge>}
                </span>
                <span className="text-right text-sm">
                  {windows.length ? (
                    windows.map((w) => (
                      <span key={w.id} className="block font-semibold text-zinc-900">
                        {hhmm(w.start_time)}–{hhmm(w.end_time)}
                      </span>
                    ))
                  ) : (
                    <span className="text-zinc-400">Not available</span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState title="No availability set yet" description="Your administrator has not recorded when you can work. Ask them to add it." />
      )}
      <Alert tone="info">To change your availability, ask your administrator. Times are Philippine time (Asia/Manila).</Alert>
    </div>
  );
}
