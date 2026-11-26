// Sends shift reminders so that nothing is sent twice. Storage and Telegram are passed in; the only import is the
// message planner, so the unit tests run this directly. SERVER ONLY.
//
// The database claim is what prevents duplicates: it hands out only rows nobody else is sending and that were not
// delivered. A result that cannot be known (timeout, network, server error, or a crash after sending) stays "unknown" or
// "sending" and is never claimed again.
import { deliverMessages, planMessages, type NotifyShift } from "./telegram-messages.ts";
import type { TelegramResult } from "./telegram.ts";

export const MAX_PASSES = 3;

export type DeliveryStatus = "sent" | "not_linked" | "failed" | "unknown";

export type ReminderShift = Omit<NotifyShift, "assignees"> & { assignees: { assignmentId: string; employeeId: string; firstName: string }[] };

export type ReminderDeps = {
  /** Claims what may be sent now and returns the claimed assignment ids. */
  claim: (assignmentIds: string[]) => Promise<string[]>;
  /** Chat ids by employee id, for linked employees only. */
  chatIds: (employeeIds: string[]) => Promise<Map<string, number>>;
  send: (chatId: number, text: string) => Promise<TelegramResult<unknown>>;
  record: (assignmentIds: string[], status: DeliveryStatus) => Promise<void>;
};

export type ReminderCounts = { sent: number; notLinked: number; failed: number; unknown: number; skipped: number };

/** One message per employee and pass, listing the shifts claimed for that person. Refused messages get up to 3 passes. */
export async function runReminders(shifts: readonly ReminderShift[], now: Date, deps: ReminderDeps): Promise<ReminderCounts> {
  const all = shifts.flatMap((s) => s.assignees.map((a) => a.assignmentId));
  const final = new Map<string, DeliveryStatus>(); // by assignment: the last result in this run
  let pending = all;

  for (let pass = 0; pass < MAX_PASSES && pending.length; pass++) {
    const claimed = new Set(await deps.claim(pending));
    if (!claimed.size) break;
    const mine = shifts
      .map((s) => ({ ...s, assignees: s.assignees.filter((a) => claimed.has(a.assignmentId)) }))
      .filter((s) => s.assignees.length);
    const messages = planMessages("reminder", mine, now);
    const chats = await deps.chatIds(messages.map((m) => m.employeeId));
    const retry: string[] = [];

    for (const message of messages) {
      const ids = mine.flatMap((s) => s.assignees.filter((a) => a.employeeId === message.employeeId).map((a) => a.assignmentId));
      const counts = await deliverMessages([message], chats, deps.send);
      const status: DeliveryStatus = counts.sent ? "sent" : counts.notLinked ? "not_linked" : counts.failed ? "failed" : "unknown";
      // If saving fails here the row stays "sending", which is never claimed again.
      await deps.record(ids, status);
      for (const id of ids) final.set(id, status);
      if (status === "failed") retry.push(...ids);
    }
    pending = retry;
  }

  // Counted per person, like the messages.
  const owner = new Map(shifts.flatMap((s) => s.assignees.map((a) => [a.assignmentId, a.employeeId] as const)));
  const people = (status: DeliveryStatus) => new Set([...final].filter(([, s]) => s === status).map(([id]) => owner.get(id))).size;
  const handled = new Set([...final.keys()].map((id) => owner.get(id)));
  return {
    sent: people("sent"),
    notLinked: people("not_linked"),
    failed: people("failed"),
    unknown: people("unknown"),
    skipped: new Set([...owner.values()].filter((id) => !handled.has(id))).size,
  };
}

export const reminderText = (c: ReminderCounts) =>
  `Telegram: ${c.sent} sent, ${c.notLinked} not linked, ${c.failed} failed, ${c.unknown} delivery unknown${c.unknown ? " (not retried)" : ""}, ${c.skipped} already handled.`;
