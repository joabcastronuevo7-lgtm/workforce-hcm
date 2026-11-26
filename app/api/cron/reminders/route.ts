import { checkApiKey } from "@/lib/hrms";
import { sendRemindersForTomorrow } from "@/lib/reminders-server";

// Called daily by Vercel Cron (vercel.json), which sends "Authorization: Bearer <CRON_SECRET>". The secret is checked
// before anything is read. The answer holds counts only: no names, chat ids or database text.
const HEADERS = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const verdict = checkApiKey(request.headers.get("authorization"), process.env.CRON_SECRET);
  if (verdict !== "ok") return Response.json({ error: verdict === "disabled" ? "unavailable" : "unauthorized" }, { status: verdict === "disabled" ? 503 : 401, headers: HEADERS });

  const run = await sendRemindersForTomorrow("scheduled");
  return Response.json(run, { status: run.outcome === "done" ? 200 : 503, headers: HEADERS });
}
