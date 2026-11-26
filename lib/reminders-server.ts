// The real storage and Telegram behind lib/reminders.ts. SERVER ONLY: uses the secret key, so callers must have already
// checked who is asking (the admin action's requireRole, or the cron route's secret).
import { runReminders, type ReminderCounts, type ReminderShift } from "@/lib/reminders";
import { addDays, toManilaParts, weekBoundsUtc } from "@/lib/scheduling";
import { createAdminClient } from "@/lib/supabase/admin";
import { callTelegram } from "@/lib/telegram";
import { shiftWhen } from "@/app/admin/schedules/notify";

export type ReminderRun =
  | { outcome: "done"; date: string; shifts: number; counts: ReminderCounts }
  | { outcome: "not_set_up"; date: string }
  | { outcome: "failed"; date: string };

export async function sendRemindersForTomorrow(source: "scheduled" | "manual", now = new Date()): Promise<ReminderRun> {
  const date = addDays(toManilaParts(now).date, 1);
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const db = createAdminClient();
  if (!token || !db) return { outcome: "not_set_up", date };

  try {
    const { data, error } = await db
      .from("shifts")
      .select("id, title, starts_at, ends_at, status, department:departments(name), position:positions(title), shift_assignments(id, employee_id, employee:employees(first_name))")
      .eq("status", "published")
      .gte("starts_at", weekBoundsUtc(date).start.toISOString())
      .lt("starts_at", weekBoundsUtc(addDays(date, 1)).start.toISOString());
    if (error) return { outcome: "failed", date };

    const shifts: ReminderShift[] = data.map((s) => ({
      id: s.id,
      title: s.title,
      when: shiftWhen(s.starts_at, s.ends_at),
      department: s.department?.name ?? "No department",
      position: s.position?.title ?? null,
      status: s.status,
      starts_at: s.starts_at,
      ends_at: s.ends_at,
      assignees: s.shift_assignments.map((a) => ({ assignmentId: a.id, employeeId: a.employee_id, firstName: a.employee?.first_name ?? "there" })),
    }));
    const startOf = new Map(shifts.flatMap((s) => s.assignees.map((a) => [a.assignmentId, s.starts_at] as const)));

    const counts = await runReminders(shifts, now, {
      claim: async (ids) => {
        const claim = await db.rpc("claim_reminders", { p_assignment_ids: ids, p_source: source });
        if (claim.error) throw new Error("claim failed");
        return claim.data.map((row) => row.shift_assignment_id);
      },
      // Chat ids: only for the people being messaged. They never leave this function.
      chatIds: async (ids) => {
        const links = await db.from("employee_telegram").select("employee_id, chat_id").in("employee_id", ids);
        if (links.error) throw new Error("links failed");
        return new Map(links.data.map((row) => [row.employee_id, row.chat_id]));
      },
      send: (chatId, text) => callTelegram(token, "sendMessage", { chat_id: chatId, text }),
      record: async (ids, status) => {
        for (const id of ids) {
          const saved = await db
            .from("reminder_deliveries")
            // A person who was not linked used no attempt.
            .update(status === "not_linked" ? { status, attempts: 0 } : { status })
            .eq("shift_assignment_id", id)
            .eq("shift_starts_at", startOf.get(id)!);
          if (saved.error) throw new Error("record failed");
        }
      },
    });
    return { outcome: "done", date, shifts: shifts.length, counts };
  } catch {
    // Deliberately silent about the cause: raw errors can contain the request address, which holds the bot token.
    return { outcome: "failed", date };
  }
}
