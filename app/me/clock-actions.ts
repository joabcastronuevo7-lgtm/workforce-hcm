"use server";

import { refresh } from "next/cache";
import type { ActionState } from "@/components/action-form";
import { requireRole } from "@/lib/auth";
import { CLOCK_ERRORS, manilaTime } from "@/lib/clock";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/validation";

// Clock in and out through the employee's own session. The database functions decide who the employee is, whether the
// shift may be clocked into, the time and the late status; the browser sends only which assignment it means.
export async function timeClock(prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("employee");
  const intent = formData.get("intent");
  const assignment = String(formData.get("assignment_id") ?? "");
  if (intent !== "out" && !(intent === "in" && isUuid(assignment))) return { error: "Refresh the page and try again." };

  const supabase = await createClient();
  const { data, error } = intent === "out" ? await supabase.rpc("clock_out") : await supabase.rpc("clock_in", { p_assignment_id: assignment });
  if (error) {
    refresh(); // the card may be out of date (second tab, second tap)
    return { error: CLOCK_ERRORS[error.message] ?? "Could not record your time. Please try again." };
  }
  refresh();
  return { success: `Clocked ${intent} at ${manilaTime(data)}.`, done: (prev.done ?? 0) + 1 };
}
