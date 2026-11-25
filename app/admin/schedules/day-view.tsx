"use client";

import { useState } from "react";
import { ShiftCard, type ShiftCardData } from "./shift-card";

export type DayColumn = {
  date: string;
  weekday: string;
  dayNumber: number;
  heading: string;
  shifts: ShiftCardData[];
  required: number;
  filled: number;
  short: number;
};

// Phones and tablets: a seven-day strip and one day's shifts as full-width cards. It only switches between days the
// server already loaded; nothing is fetched here.
export function DayView({ days, today }: { days: DayColumn[]; today: string }) {
  const [selected, setSelected] = useState(
    () => (days.find((d) => d.date === today) ?? days.find((d) => d.shifts.length) ?? days[0]).date,
  );
  const day = days.find((d) => d.date === selected) ?? days[0];

  return (
    <div className="space-y-3">
      <div role="group" aria-label="Day" className="grid grid-cols-7 gap-1 rounded-xl border border-zinc-200 bg-white p-1">
        {days.map((d) => {
          const active = d.date === day.date;
          return (
            <button
              key={d.date}
              type="button"
              aria-pressed={active}
              aria-label={`${d.heading}, ${d.shifts.length} shift(s)${d.short ? `, ${d.short} short` : ""}`}
              onClick={() => setSelected(d.date)}
              className={`relative flex min-h-16 flex-col items-center justify-center rounded-lg text-xs transition-colors ${
                active ? "bg-teal-700 text-white" : "text-zinc-600 active:bg-zinc-100"
              }`}
            >
              <span className={`font-medium ${active ? "text-teal-100" : d.date === today ? "text-teal-700" : ""}`}>{d.weekday}</span>
              <span className="text-lg leading-6 font-semibold">{d.dayNumber}</span>
              <span className={`text-[10px] ${active ? "text-teal-100" : "text-zinc-400"}`}>{d.shifts.length || "–"}</span>
              {d.short > 0 && (
                <span aria-hidden className={`absolute top-1.5 right-1.5 size-1.5 rounded-full ${active ? "bg-amber-300" : "bg-amber-500"}`} />
              )}
            </button>
          );
        })}
      </div>

      <div className="flex items-baseline justify-between gap-2 px-1">
        <h3 className="text-base font-semibold text-zinc-900">
          {day.heading}
          {day.date === today && <span className="ml-2 text-xs font-medium text-teal-700">Today</span>}
        </h3>
        <p className="text-xs text-zinc-500">
          {day.shifts.length} shift(s)
          {day.required > 0 && ` · ${day.filled}/${day.required} filled`}
          {day.short > 0 && <span className="font-medium text-amber-700"> · {day.short} short</span>}
        </p>
      </div>

      {day.shifts.length ? (
        <ul className="space-y-2">
          {day.shifts.map((s) => (
            <li key={s.id}>
              <ShiftCard shift={s} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed border-zinc-300 bg-white px-4 py-8 text-center text-sm text-zinc-500">No shifts on this day</p>
      )}
    </div>
  );
}
