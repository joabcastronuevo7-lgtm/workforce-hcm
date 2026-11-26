import { checkApiKey } from "@/lib/hrms";
import { MAX_BODY_BYTES, parseImportBody, planImport } from "@/lib/hrms-import";
import { createAdminClient } from "@/lib/supabase/admin";

// POST /api/hrms/v1/employees. Its own key (HRMS_IMPORT_KEY): a signed-in session or the read key cannot use it. The key
// is checked before the body is read and before any database client exists. Preview unless mode is "apply". Apply is all
// or nothing: one rejected employee means nothing is written. It creates and updates, matched by external_ref; it never
// deletes and never touches a login. Every validated request is recorded in hrms_import_log; if that record cannot be
// made, nothing is written.
const HEADERS = { "Cache-Control": "no-store" };
const refuse = (status: number, code: string, message: string, extra: Record<string, string> = {}) =>
  Response.json({ error: { code, message } }, { status, headers: { ...HEADERS, ...extra } });

export async function handleImport(request: Request): Promise<Response> {
  const key = process.env.HRMS_IMPORT_KEY;
  // Sharing one value with the read key would let every reader write, so that switches the import off.
  const verdict = key && key === process.env.HRMS_API_KEY ? "disabled" : checkApiKey(request.headers.get("authorization"), key);
  if (verdict === "disabled") return refuse(503, "unavailable", "The HRMS import is not switched on.");
  if (verdict !== "ok") return refuse(401, "unauthorized", "A valid import key is required in the Authorization header.", { "WWW-Authenticate": "Bearer" });

  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
    return refuse(415, "unsupported_media_type", "Send the body as application/json.");
  const tooLarge = () => refuse(413, "payload_too_large", `The body may be at most ${MAX_BODY_BYTES} bytes.`);
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return tooLarge();
  const text = await request.text();
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) return tooLarge();
  const body = parseImportBody(text);
  if (!body.ok) return refuse(400, "invalid_request", body.message);

  const db = createAdminClient();
  if (!db) return refuse(503, "unavailable", "The HRMS import is not switched on.");
  const failed = () => refuse(500, "server_error", "The import could not be completed. Nothing was confirmed as written.");

  try {
    const [employees, departments, positions] = await Promise.all([
      db.from("employees").select("external_ref, employee_code, email, profile_id").limit(10_000),
      db.from("departments").select("id, name"),
      db.from("positions").select("id, title, department_id"),
    ]);
    if (employees.error || departments.error || positions.error) return failed();

    const plan = planImport(body.employees, employees.data, { departments: departments.data, positions: positions.data });
    const apply = body.mode === "apply" && plan.rejected === 0;
    const outcome = body.mode === "preview" ? "previewed" : apply ? "applying" : "rejected";

    const log = await db
      .from("hrms_import_log")
      .insert({ mode: body.mode, outcome, total: body.employees.length, created: plan.created, updated: plan.updated, rejected: plan.rejected, results: plan.results })
      .select("id")
      .single();
    if (log.error) return failed();

    if (apply) {
      // One statement, so it is applied completely or not at all. profile_id is not among the columns.
      const write = await db.from("employees").upsert(plan.rows, { onConflict: "external_ref" });
      await db.from("hrms_import_log").update({ outcome: write.error ? "failed" : "applied" }).eq("id", log.data.id);
      if (write.error) return failed();
    }

    return Response.json(
      {
        import_id: log.data.id,
        mode: body.mode,
        applied: apply,
        summary: { total: body.employees.length, create: plan.created, update: plan.updated, reject: plan.rejected },
        results: plan.results,
      },
      { status: body.mode === "apply" && !apply ? 422 : 200, headers: HEADERS },
    );
  } catch {
    return failed();
  }
}
