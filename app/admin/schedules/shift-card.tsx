import Link from "next/link";
import { Badge } from "@/components/ui";

// Display-ready shift: every string and tone is worked out on the server (week-grid.tsx), so this card
// renders the same in the server-rendered desktop grid and in the client-side mobile day view.
export type ShiftCardData = {
  id: string;
  time: string;
  title: string;
  meta: string;
  status: { tone: "teal" | "zinc" | "red"; label: string };
  headcount: { tone: "green" | "amber" | "red" | "zinc"; text: string };
  draft: boolean;
  cancelled: boolean;
};

const accent = { red: "before:bg-red-500", amber: "before:bg-amber-500", green: "before:bg-emerald-500", zinc: "before:bg-zinc-300" };

export function ShiftCard({ shift, compact }: { shift: ShiftCardData; compact?: boolean }) {
  return (
    <Link
      href={`/admin/schedules/${shift.id}`}
      className={`relative block overflow-hidden rounded-lg border pl-3.5 before:absolute before:inset-y-0 before:left-0 before:w-1 ${accent[shift.headcount.tone]} ${
        shift.draft ? "border-dashed border-zinc-300 bg-zinc-50" : "border-zinc-200 bg-white"
      } ${shift.cancelled ? "opacity-60" : ""} ${
        compact ? "py-2 pr-2.5 text-xs" : "py-3 pr-3 text-sm active:bg-zinc-50"
      } hover:border-teal-600/50`}
    >
      <p className={`font-semibold text-zinc-900 ${compact ? "" : "text-base"}`}>{shift.time}</p>
      <p className={`mt-0.5 text-zinc-800 ${shift.cancelled ? "line-through" : ""}`}>
        {shift.title}
        <span className="sr-only"> at {shift.time}, open shift</span>
      </p>
      <p className={`text-zinc-500 ${compact ? "" : "text-xs"}`}>{shift.meta}</p>
      <div className="mt-1.5 flex flex-wrap gap-1">
        <Badge tone={shift.status.tone}>{shift.status.label}</Badge>
        <Badge tone={shift.headcount.tone}>{shift.headcount.text}</Badge>
      </div>
    </Link>
  );
}
