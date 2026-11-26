import assert from "node:assert/strict";
import { test } from "node:test";
import { clockState, manilaTime } from "../lib/clock.ts";

const now = new Date("2026-11-27T06:00:00Z"); // 14:00 Manila
const at = (min) => new Date(now.getTime() + min * 60_000).toISOString();
const shift = (assignmentId, start, end) => ({ assignmentId, startsAt: at(start), endsAt: at(end) });

test("clock in opens exactly 30 minutes before the start and closes at the end", () => {
  assert.equal(clockState([shift("a", 30, 500)], [], now).kind, "ready");
  const early = clockState([shift("a", 31, 500)], [], now);
  assert.equal(early.kind, "wait");
  assert.equal(early.opensAt, at(1));
  assert.equal(clockState([shift("a", -500, 0)], [], now).kind, "none");
});

test("an open record offers clock out, even after the shift ended", () => {
  const s = clockState([shift("a", -600, -60)], [{ assignmentId: "a", clockIn: at(-590), clockOut: null }], now);
  assert.equal(s.kind, "in");
  assert.equal(s.shift.assignmentId, "a");
});

test("a record older than 24 hours neither blocks nor offers clock out", () => {
  const s = clockState([shift("b", 0, 480)], [{ assignmentId: "a", clockIn: at(-25 * 60), clockOut: null }], now);
  assert.equal(s.kind, "ready");
});

test("a shift with attendance is not offered again, including an absent record", () => {
  assert.equal(clockState([shift("a", -10, 480)], [{ assignmentId: "a", clockIn: at(-10), clockOut: at(-1) }], now).kind, "none");
  assert.equal(clockState([shift("a", -10, 480)], [{ assignmentId: "a", clockIn: null, clockOut: null }], now).kind, "none");
});

test("back-to-back shifts offer the one being arrived for", () => {
  const s = clockState([shift("old", -480, 20), shift("new", 20, 500)], [], now);
  assert.equal(s.shift.assignmentId, "new");
});

test("times are shown in Manila", () => {
  assert.equal(manilaTime("2026-11-27T06:05:00Z"), "14:05");
  assert.equal(manilaTime("2026-11-26T16:00:00Z"), "00:00");
});
