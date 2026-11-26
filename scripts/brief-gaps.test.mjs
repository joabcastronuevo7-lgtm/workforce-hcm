import assert from "node:assert/strict";
import { test } from "node:test";
import { tenureBand, tenureRange, unitName, yearsBefore } from "../lib/business-units.ts";
import { parseImportBody, planImport } from "../lib/hrms-import.ts";
import { runReminders } from "../lib/reminders.ts";

// --- business units ---------------------------------------------------------------------------------------------------
test("tenure bands change on the anniversaries, and the database range agrees with the band", () => {
  const today = "2026-11-26";
  const cases = { "2026-11-26": "under_1", "2025-11-27": "under_1", "2025-11-26": "1_to_3", "2023-11-27": "1_to_3", "2023-11-26": "over_3" };
  for (const [hired, band] of Object.entries(cases)) {
    assert.equal(tenureBand(hired, today), band, hired);
    for (const other of ["under_1", "1_to_3", "over_3"]) {
      const { after, upTo } = tenureRange(other, today);
      assert.equal((!after || hired > after) && (!upTo || hired <= upTo), other === band, `${hired} in ${other}`);
    }
  }
  assert.equal(yearsBefore("2028-02-29", 1), "2027-02-28");
});

test("report units: division, location with a missing value, tenure", () => {
  const row = { department: "Retail", location: null, hireDate: "2020-01-01" };
  assert.equal(unitName("department", row, "2026-11-26"), "Retail");
  assert.equal(unitName("location", row, "2026-11-26"), "No location set");
  assert.equal(unitName("tenure", row, "2026-11-26"), "3 years or more");
});

// --- reminders --------------------------------------------------------------------------------------------------------
const now = new Date("2026-11-26T10:00:00Z");
const shift = (id, assignees) => ({
  id, title: id, when: "tomorrow", department: "D", position: null, status: "published",
  starts_at: "2026-11-27T00:00:00Z", ends_at: "2026-11-27T08:00:00Z",
  assignees: assignees.map(([assignmentId, employeeId]) => ({ assignmentId, employeeId, firstName: employeeId })),
});

// The same claim rule as the database function.
function store() {
  const rows = new Map();
  return {
    rows,
    claim: async (ids) =>
      ids.filter((id) => {
        const row = rows.get(id);
        if (row && !(row.status === "not_linked" || (row.status === "failed" && row.attempts < 3))) return false;
        rows.set(id, { status: "sending", attempts: row ? row.attempts + 1 : 1 });
        return true;
      }),
    record: async (ids, status) => ids.forEach((id) => (rows.get(id).status = status)),
  };
}
const chats = async () => new Map([["ann", 1]]);
const day = [shift("am", [["a1", "ann"], ["b1", "bo"]]), shift("pm", [["a2", "ann"]])];

test("two shifts on one day make one message, both tracked, and a second run sends nothing", async () => {
  const db = store();
  const sent = [];
  const deps = { ...db, chatIds: chats, send: async (_, text) => (sent.push(text), { ok: true, result: {} }) };
  const first = await runReminders(day, now, deps);
  assert.deepEqual(first, { sent: 1, notLinked: 1, failed: 0, unknown: 0, skipped: 0 });
  assert.equal(sent.length, 1);
  assert.match(sent[0], /am[\s\S]*pm/);
  assert.equal(db.rows.get("a1").status, "sent");
  assert.equal(db.rows.get("a2").status, "sent");
  const second = await runReminders(day, now, deps);
  assert.equal(sent.length, 1);
  assert.equal(second.sent, 0);
  assert.equal(second.skipped, 1);
});

test("an unknown delivery is never sent again", async () => {
  for (const reason of ["timeout", "network"]) {
    const db = store();
    let calls = 0;
    const deps = { ...db, chatIds: chats, send: async () => (calls++, { ok: false, reason }) };
    assert.equal((await runReminders(day, now, deps)).unknown, 1);
    await runReminders(day, now, deps);
    assert.equal(calls, 1, reason);
  }
});

test("a refusal is retried up to three attempts and no more, across runs", async () => {
  const db = store();
  let calls = 0;
  const deps = { ...db, chatIds: chats, send: async () => (calls++, { ok: false, reason: "rejected", status: 429 }) };
  assert.equal((await runReminders(day, now, deps)).failed, 1);
  await runReminders(day, now, deps);
  assert.equal(calls, 3);
});

test("if saving the result fails after sending, the claim stays and nothing is resent", async () => {
  const db = store();
  let calls = 0;
  const deps = { ...db, chatIds: chats, record: async () => { throw new Error("db down"); }, send: async () => (calls++, { ok: true, result: {} }) };
  await assert.rejects(runReminders(day, now, deps));
  await runReminders(day, now, { ...deps, record: db.record });
  assert.equal(calls, 1);
});

// --- HRMS import ------------------------------------------------------------------------------------------------------
const org = { departments: [{ id: "8607010a-ff2d-4397-936d-000000000001", name: "Support" }], positions: [{ id: "8607010a-ff2d-4397-936d-000000000002", title: "Agent", department_id: "8607010a-ff2d-4397-936d-000000000001" }] };
const person = (over = {}) => ({
  external_ref: "H-1", employee_code: "emp-900", first_name: "Sam", last_name: "Lee", work_email: "Sam@Example.com", department: "support",
  position: "agent", employment_type: "full_time", status: "active", hire_date: "2026-01-05", max_weekly_hours: 40, location: null, ...over,
});
const current = [{ external_ref: "H-2", employee_code: "EMP-901", email: "kim@example.com", profile_id: "p" }];

test("the body is a preview unless apply is asked for, and is limited", () => {
  assert.equal(parseImportBody(JSON.stringify({ employees: [person()] })).mode, "preview");
  for (const bad of ["x", "[]", '{"employees":[]}', '{"employees":[1],"mode":"force"}', '{"employees":[1],"delete":true}', JSON.stringify({ employees: Array(101).fill(person()) })])
    assert.equal(parseImportBody(bad).ok, false, bad.slice(0, 40));
});

test("create and update are planned with only the approved columns", () => {
  const plan = planImport([person(), person({ external_ref: "H-2", employee_code: "EMP-901", work_email: "kim@example.com" })], current, org);
  assert.deepEqual(plan.results.map((r) => r.action), ["create", "update"]);
  assert.equal(plan.rows[0].email, "sam@example.com");
  assert.equal(plan.rows[0].employee_code, "EMP-900");
  assert.ok(plan.rows.every((row) => !("profile_id" in row) && Object.keys(row).length === 12));
});

test("duplicates, conflicts, unknown fields and login email changes are rejected", () => {
  const rejected = (entries) => planImport(entries, current, org).results.map((r) => r.errors.join(" "));
  assert.match(rejected([person(), person({ employee_code: "EMP-902", work_email: "x@example.com" })])[1], /external_ref appears more than once/);
  assert.match(rejected([person({ employee_code: "EMP-901" })])[0], /employee_code belongs to another/);
  assert.match(rejected([person({ work_email: "KIM@example.com" })])[0], /work_email belongs to another/);
  assert.match(rejected([person({ external_ref: "H-2", employee_code: "EMP-901" })])[0], /cannot change: this employee has a login/);
  assert.match(rejected([person({ profile_id: "evil" })])[0], /Unknown field/);
  assert.match(rejected([person({ location: undefined })])[0], /location must be text or null/);
  assert.match(rejected([person({ position: "Boss" })])[0], /position does not exist/);
  assert.match(rejected([person({ hire_date: "2026-02-30" })])[0], /hire_date/);
  assert.match(rejected([person({ max_weekly_hours: 200 })])[0], /max_weekly_hours/);
  assert.match(rejected(["x"])[0], /must be an object/);
});

test("results never echo names or emails", () => {
  const plan = planImport([person({ position: "Boss" })], current, org);
  assert.doesNotMatch(JSON.stringify(plan.results), /sam|lee@|example\.com/i);
});
