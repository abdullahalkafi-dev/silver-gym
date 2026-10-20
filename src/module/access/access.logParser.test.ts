declare const require: (moduleId: string) => any;

const assert = require("node:assert/strict");
const test = require("node:test").test;

import { parseDeviceWallClock, toVerifyMode } from "./access.logParser";

test("device wall clock is read as Dhaka time regardless of the zone text", () => {
  const parsed = parseDeviceWallClock(
    "Sat Oct 17 2026 16:31:04 GMT+0000 (Coordinated Universal Time)",
  );
  assert.ok(parsed);
  // 16:31 Dhaka = 10:31 UTC
  assert.equal(parsed!.punchTime.toISOString(), "2026-10-17T10:31:04.000Z");
  assert.equal(parsed!.attendanceDate, "2026-10-17");

  const other = parseDeviceWallClock(
    "Sat Oct 17 2026 16:31:04 GMT+0600 (Bangladesh Standard Time)",
  );
  assert.equal(other!.punchTime.toISOString(), "2026-10-17T10:31:04.000Z");
});

test("a scan just after midnight Dhaka belongs to the new Dhaka day", () => {
  const parsed = parseDeviceWallClock("Tue Oct 20 2026 00:05:00 GMT+0000");
  assert.equal(parsed!.attendanceDate, "2026-10-20");
  assert.equal(parsed!.punchTime.toISOString(), "2026-10-19T18:05:00.000Z");
});

test("garbage is rejected", () => {
  assert.equal(parseDeviceWallClock("not a date"), null);
  assert.equal(parseDeviceWallClock(""), null);
});

test("verify modes", () => {
  assert.equal(toVerifyMode(1), "fingerprint");
  assert.equal(toVerifyMode(4), "card");
  assert.equal(toVerifyMode(15), "other");
});
