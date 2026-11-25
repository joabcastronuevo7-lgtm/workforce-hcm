import { formatDayHeading, formatTimeRange, headcountState, shiftsByDay, type HeadcountState, type ShiftStatus } from "@/lib/scheduling";
import { DayView, type DayColumn } from "./day-view";
import { ShiftCard, type ShiftCardData } from "./shift-card";

export type WeekShift = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  required_headcount: number;
  status: ShiftStatus;
  department: { id: string; name: string } | null;
  position: { title: string } | null;
  assigned: number;
};

const HEADCOUNT: Record<HeadcountState, { tone: "green" | "amber" | "red" | "zinc"; text: (a: number, r: number) => string }> = {
  unfilled: { tone: "red", text: (a, r) => `${a}/${r} · unfilled` },
  under: { tone: "amber", text: (a, r) => `${a}/${r} · short ${r - a}` },
  filled: { tone: "green", text: (a, r) => `${a}/${r} · filled` },
  over: { tone: "amber", text: (a, r) => `${a}/${r} · +${a - r} over` },
  cancelled: { tone: "zinc", text: (a, r) => `${a}/${r}` },
};

const STATUS: Record<ShiftStatus, { tone: "teal" | "zinc" | "red"; label: string }> = {
  published: { tone: "teal", label: "Published" },
  draft: { tone: "zinc", label: "Draft" },
  cancelled: { tone: "red", label: "Cancelled" },
};

function toCard(s: WeekShift): ShiftCardData {
  const state = headcountState(s.assigned, s.required_headcount, s.status);
  return {
    id: s.id,
    time: formatTimeRange(s.starts_at, s.ends_at),
    title: s.title,
    meta: `${s.department?.name ?? "No department"}${s.position ? ` · ${s.position.title}` : ""}`,
    status: STATUS[s.status],
    headcount: { tone: HEADCOUNT[state].tone, text: HEADCOUNT[state].text(s.assigned, s.required_headcount) },
    draft: s.status === "draft",
    cancelled: s.status === "cancelled",
  };
}

// Seven-day Manila week. Shifts sit on the day they start; each opens its shift page, where editing, assigning and
// publishing happen. Below xl the week is a day strip with one day's cards (DayView); from xl up, a seven-column grid.
export function WeekGrid({ weekStart, shifts, today }: { weekStart: string; shifts: WeekShift[]; today: string }) {
  const days: DayColumn[] = [...shiftsByDay(shifts, weekStart)].map(([date, list]) => {
    const live = list.filter((s) => s.status !== "cancelled");
    const heading = formatDayHeading(date);
    return {
      date,
      heading,
      weekday: heading.split(" ")[0],
      dayNumber: Number(date.slice(8, 10)),
      shifts: list.map(toCard),
      required: live.reduce((sum, s) => sum + s.required_headcount, 0),
      filled: live.reduce((sum, s) => sum + Math.min(s.assigned, s.required_headcount), 0),
      short: live.filter((s) => ["unfilled", "under"].includes(headcountState(s.assigned, s.required_headcount, s.status))).length,
    };
  });

  return (
    <>
      <div className="xl:hidden">
        <DayView days={days} today={today} />
      </div>
      <div className="hidden gap-2 xl:grid xl:grid-cols-7">
        {days.map((d) => (
          <section key={d.date} aria-labelledby={`day-${d.date}`} className="min-w-0 rounded-xl border border-zinc-200 bg-white">
            <header
              className={`flex items-baseline justify-between gap-2 border-b px-3 py-2 ${
                d.date === today ? "border-teal-200 bg-teal-50" : "border-zinc-200"
              }`}
            >
              <h3 id={`day-${d.date}`} className="text-sm font-semibold text-zinc-900">
                {d.heading}
              </h3>
              {d.date === today ? (
                <span className="text-xs font-medium text-teal-700">Today</span>
              ) : (
                <span className="text-xs text-zinc-400">{d.shifts.length}</span>
              )}
            </header>
            {d.required > 0 && (
              <p className={`border-b border-zinc-100 px-3 py-1 text-[11px] ${d.short ? "font-medium text-amber-700" : "text-zinc-500"}`}>
                {d.filled}/{d.required} filled{d.short ? ` · ${d.short} short` : ""}
              </p>
            )}
            {d.shifts.length ? (
              <ul className="space-y-2 p-2">
                {d.shifts.map((s) => (
                  <li key={s.id}>
                    <ShiftCard shift={s} compact />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-3 py-4 text-xs text-zinc-400">No shifts</p>
            )}
          </section>
        ))}
      </div>
    </>
  );
}
