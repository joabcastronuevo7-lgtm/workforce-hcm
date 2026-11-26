import Link from "next/link";
import { ActionForm, ConfirmSubmit, SubmitButton } from "@/components/action-form";
import { Badge } from "@/components/ui";
import { manilaTime, type ClockShift, type ClockState } from "@/lib/clock";
import { formatDayHeading, formatTimeRange, toManilaParts } from "@/lib/scheduling";
import { timeClock } from "./clock-actions";

type Shift = ClockShift & { title: string };

// One form that stays mounted across states, so the "Clocked in at …" message survives the refresh.
export function TimeClock({ state }: { state: ClockState<Shift> }) {
  const shiftLine = (s: Shift) => `${s.title} · ${formatDayHeading(toManilaParts(s.startsAt).date)} · ${formatTimeRange(s.startsAt, s.endsAt)}`;

  return (
    <section aria-labelledby="time-clock" className={`rounded-2xl border bg-white p-4 ${state.kind === "in" ? "border-amber-300" : "border-zinc-200"}`}>
      <div className="flex items-center justify-between gap-2">
        <h2 id="time-clock" className="text-sm font-semibold text-zinc-900">
          Time clock
        </h2>
        <Badge tone={state.kind === "in" ? "amber" : state.kind === "ready" ? "teal" : "zinc"}>
          {state.kind === "in" ? "Clocked in" : state.kind === "ready" ? "Ready" : "Clocked out"}
        </Badge>
      </div>

      <ActionForm action={timeClock} className="mt-2 space-y-3 [&_button]:min-h-14 [&_button]:w-full [&_button]:text-base [&_dialog_button]:min-h-11">
        {state.kind === "in" ? (
          <>
            <p className="text-2xl font-semibold tracking-tight text-zinc-900">Since {manilaTime(state.since)}</p>
            <p className="text-sm text-zinc-500">{state.shift ? shiftLine(state.shift) : "Your open shift"}</p>
            <input type="hidden" name="intent" value="out" />
            <ConfirmSubmit
              label="Clock out"
              variant="primary"
              tone="primary"
              title="Clock out now?"
              message="Your clock-out time is recorded now. You cannot clock in to this shift again."
              confirmLabel="Clock out"
            />
          </>
        ) : state.kind === "ready" ? (
          <>
            <p className="text-sm text-zinc-500">{shiftLine(state.shift)}</p>
            <input type="hidden" name="intent" value="in" />
            <input type="hidden" name="assignment_id" value={state.shift.assignmentId} />
            <SubmitButton pendingText="Clocking in…">Clock in</SubmitButton>
          </>
        ) : state.kind === "wait" ? (
          <>
            <p className="text-base font-semibold text-zinc-900">
              Clock in opens {formatDayHeading(toManilaParts(state.opensAt).date)} at {manilaTime(state.opensAt)}
            </p>
            <p className="text-sm text-zinc-500">{shiftLine(state.shift)}</p>
          </>
        ) : (
          <p className="text-sm text-zinc-500">No shift to clock in to.</p>
        )}
      </ActionForm>

      <Link href="/me/attendance" className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-teal-700 hover:underline">
        View attendance history
      </Link>
    </section>
  );
}
