// End-to-end check of sign-in redirects against a FAKE Supabase on this computer: no real project, account or secret is
// used. It builds the app pointed at the fake, starts it and follows redirects the way a browser would.
// Run: node scripts/auth-redirect.e2e.mjs   (rebuild afterwards before using the normal build)
import { spawn, execSync } from "node:child_process";
import { createServer } from "node:http";
import { generateKeyPairSync, sign, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const AUTH = "http://127.0.0.1:54999";
const APP = "http://localhost:3200";
const COOKIE = "sb-127-auth-token";

// --- fake Supabase ------------------------------------------------------------------------------------------------
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "test", alg: "ES256", use: "sig" };
const b64 = (v) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");
const users = {
  admin: { id: "11111111-1111-4111-8111-111111111111", role: "admin" },
  employee: { id: "22222222-2222-4222-8222-222222222222", role: "employee" },
};
const sessions = new Map(); // session id -> { who, state: "ok" | "revoked" | "gone" | "outage" | "noprofile", refresh: bool }
const logouts = [];
const token = (who, sid, lifetime) => {
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: "ES256", typ: "JWT", kid: "test" });
  const body = b64({ sub: users[who].id, session_id: sid, role: "authenticated", aud: "authenticated", iat: now - 7200, exp: now + lifetime, iss: AUTH + "/auth/v1", email: who + "@test.invalid" });
  return `${head}.${body}.${sign("sha256", Buffer.from(`${head}.${body}`), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
};
const userBody = (who) => ({ id: users[who].id, aud: "authenticated", role: "authenticated", email: who + "@test.invalid", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() });
const session = (who, sid, lifetime = 3600) => ({ access_token: token(who, sid, lifetime), refresh_token: "r-" + sid, token_type: "bearer", expires_in: lifetime, expires_at: Math.floor(Date.now() / 1000) + lifetime, user: userBody(who) });

const fake = createServer((req, res) => {
  const url = new URL(req.url, AUTH);
  const send = (status, body, headers = {}) => { res.writeHead(status, { "Content-Type": "application/json", ...headers }); res.end(body === undefined ? "" : JSON.stringify(body)); };
  let raw = "";
  req.on("data", (d) => (raw += d));
  req.on("end", () => {
    let claims = {};
    try { claims = JSON.parse(Buffer.from((req.headers.authorization ?? "").split(".")[1], "base64url")); } catch {}
    const s = sessions.get(claims.session_id);
    if (url.pathname.endsWith("/jwks.json")) return send(200, { keys: [jwk] });
    if (url.pathname === "/auth/v1/user") {
      if (s?.state === "outage") return send(503, { message: "unavailable" });
      if (s?.state === "revoked") return send(403, { code: 403, error_code: "session_not_found", msg: "Session from session_id claim in JWT does not exist" });
      if (s?.state === "gone") return send(403, { code: 403, error_code: "user_not_found", msg: "User from sub claim in JWT does not exist" });
      return s ? send(200, userBody(s.who)) : send(401, { code: 401, error_code: "bad_jwt", msg: "invalid" });
    }
    if (url.pathname === "/auth/v1/token") {
      const sid = (JSON.parse(raw || "{}").refresh_token ?? "").slice(2);
      const r = sessions.get(sid);
      return r?.refresh ? send(200, session(r.who, sid)) : send(400, { code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token" });
    }
    if (url.pathname === "/auth/v1/logout") {
      logouts.push({ sid: claims.session_id, scope: url.searchParams.get("scope") });
      return s?.state === "revoked" || s?.state === "gone" ? send(403, { code: 403, error_code: "session_not_found", msg: "gone" }) : send(204);
    }
    if (url.pathname === "/rest/v1/profiles" && s) {
      if (s.state === "noprofile") return send(406, { code: "PGRST116", message: "no rows" });
      const row = { id: users[s.who].id, email: s.who + "@test.invalid", full_name: s.who, role: users[s.who].role };
      return send(200, req.headers.accept?.includes("pgrst.object") ? row : [row]);
    }
    if (url.pathname.startsWith("/rest/v1/")) return send(200, req.headers.accept?.includes("pgrst.object") ? null : [], { "Content-Range": "*/0" });
    send(404, {});
  });
});

// --- a small browser ------------------------------------------------------------------------------------------------
function browser(who, options = {}) {
  const jar = new Map();
  let sid = null;
  if (who) {
    sid = randomUUID();
    sessions.set(sid, { who, state: options.state ?? "ok", refresh: options.refresh ?? true });
    jar.set(COOKIE, "base64-" + b64(session(who, sid, options.lifetime ?? 3600)));
  }
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  async function request(path, init = {}) {
    const res = await fetch(APP + path, { redirect: "manual", signal: AbortSignal.timeout(30000), ...init, headers: { ...(jar.size ? { cookie: cookie() } : {}), ...init.headers } });
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(";");
      const at = pair.indexOf("=");
      const name = pair.slice(0, at).trim(), value = pair.slice(at + 1);
      if (!value || attrs.some((a) => /max-age=0/i.test(a))) jar.delete(name);
      else jar.set(name, value);
    }
    return res;
  }
  /** Follows HTTP and streamed page redirects. */
  async function visit(path) {
    const trail = [path];
    for (let hop = 0; hop < 8; hop++) {
      const res = await request(path);
      const text = await res.text();
      const next = res.status >= 300 && res.status < 400 ? res.headers.get("location") : (text.match(/<meta id="__next-page-redirect" http-equiv="refresh" content="\d+;url=([^"]+)"/)?.[1] ?? text.match(/NEXT_REDIRECT;(?:replace|push);([^;"\\]+);30[78]/)?.[1]);
      if (!next) return { status: res.status, path, trail, text, loop: false };
      path = new URL(next, APP).pathname;
      trail.push(path);
    }
    return { status: 0, path, trail, text: "", loop: true };
  }
  return { jar, sid, request, visit, signedIn: () => [...jar.keys()].some((k) => k.startsWith(COOKIE)) };
}

// --- checks ---------------------------------------------------------------------------------------------------------
let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(ok ? "PASS" : "FAIL", name, ok ? "" : detail); };
const ends = async (name, b, from, to, extra = () => true) => {
  const r = await b.visit(from);
  check(`${name}: ${from} -> ${to}`, !r.loop && r.path === to && r.status === 200 && extra(), `${r.loop ? "LOOP " : ""}status ${r.status} trail ${r.trail.join(" > ")}`);
};

const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: AUTH, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-publishable", SUPABASE_SECRET_KEY: "test-secret", TELEGRAM_BOT_TOKEN: "", CRON_SECRET: "", HRMS_API_KEY: "", HRMS_IMPORT_KEY: "" };
await new Promise((r) => fake.listen(54999, "127.0.0.1", r));
// spawn (not spawnSync) so the fake server keeps answering while the app builds.
const built = await new Promise((r) => spawn(process.execPath, ["node_modules/next/dist/bin/next", "build"], { cwd: root, env, stdio: "ignore" }).on("exit", r));
if (built !== 0) { console.error("build failed"); process.exit(1); }
const app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", "3200"], { cwd: root, env, stdio: "ignore" });
try {
  for (let i = 0; i < 60; i++) { try { await fetch(APP + "/login"); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }

  const anon = browser(null);
  for (const from of ["/", "/admin", "/admin/reports", "/me", "/me/attendance", "/login"]) await ends("signed out", anon, from, "/login");

  const admin = browser("admin");
  await ends("admin", admin, "/", "/admin");
  await ends("admin", admin, "/login", "/admin");
  await ends("admin", admin, "/admin", "/admin");
  await ends("admin kept out of employee pages", admin, "/me", "/admin", admin.signedIn);

  const employee = browser("employee");
  await ends("employee", employee, "/", "/me");
  await ends("employee", employee, "/login", "/me");
  await ends("employee", employee, "/me/attendance", "/me/attendance");
  await ends("employee kept out of admin pages", employee, "/admin", "/me", employee.signedIn);
  await ends("employee kept out of admin pages", employee, "/admin/reports", "/me", employee.signedIn);

  for (const state of ["revoked", "gone"]) {
    for (const from of ["/", "/login", "/admin", "/me"]) {
      const b = browser("admin", { state });
      await ends(`${state} session, cookie cleared`, b, from, "/login", () => !b.signedIn());
    }
  }

  const fresh = browser("employee", { lifetime: -60 });
  await ends("expired token, refresh accepted, stays signed in", fresh, "/me", "/me", fresh.signedIn);
  const dead = browser("employee", { lifetime: -60, refresh: false });
  await ends("expired token, refresh refused, cleared", dead, "/me", "/login", () => !dead.signedIn());

  const outage = browser("admin", { state: "outage" });
  const before = logouts.length;
  for (const from of ["/", "/login", "/admin"]) await ends("auth server down, session kept", outage, from, "/login", outage.signedIn);
  check("auth server down: nothing was signed out", logouts.length === before);
  sessions.get(outage.sid).state = "ok";
  await ends("after the outage the same session works", outage, "/", "/admin");

  const orphan = browser("employee", { state: "noprofile" });
  await ends("account without a profile, no loop, session kept", orphan, "/", "/login", orphan.signedIn);

  // Revoking one session must not touch another.
  const keeper = browser("admin");
  await browser("admin", { state: "revoked" }).visit("/");
  await ends("another session is untouched", keeper, "/admin", "/admin", keeper.signedIn);
  check("clearing a rejected session never signs out other devices", logouts.every((l) => l.scope === "local"), JSON.stringify(logouts));

  // Sign out, submitted as the browser would without JavaScript.
  const leaving = browser("admin");
  const page = await leaving.visit("/admin");
  const form = [...page.text.matchAll(/<form[^>]*>([\s\S]*?)<\/form>/g)].map((m) => m[1]).find((f) => f.includes("Sign out") && f.includes("$ACTION"));
  if (!form) check("sign out form found", false);
  else {
    const data = new FormData();
    for (const [, tag] of form.matchAll(/<input([^>]*)>/g)) {
      const name = tag.match(/name="([^"]*)"/)?.[1];
      if (name) data.set(name, (tag.match(/value="([^"]*)"/)?.[1] ?? "").replaceAll("&quot;", '"').replaceAll("&amp;", "&"));
    }
    const res = await leaving.request("/admin", { method: "POST", body: data, headers: { origin: APP } });
    await res.text();
    check("sign out clears the cookie", !leaving.signedIn(), `status ${res.status}`);
    check("sign out calls the auth server", logouts.some((l) => l.sid === leaving.sid), JSON.stringify(logouts.slice(-2)));
    await ends("after sign out", leaving, "/admin", "/login");
  }
} finally {
  try {
    if (process.platform === "win32") execSync(`taskkill /PID ${app.pid} /T /F`, { stdio: "ignore" });
    else app.kill();
  } catch {}
  fake.close();
}
console.log(failed ? `${failed} FAILED` : "all passed");
process.exit(failed ? 1 : 0);
