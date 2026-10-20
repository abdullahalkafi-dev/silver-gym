declare const require: (moduleId: string) => any;

const assert = require("node:assert/strict");
const test = require("node:test").test;

import { assessBlockSafety, planDeviceAccessSync, TMemberDecision } from "./access.syncPlan";
import {
  onlyGroupDiffers,
  parseUserRecord,
  splitUserBlob,
  USER_RECORD_SIZE,
  withGroup,
} from "./access.userRecord";

const makeRecord = (opts: { uid: number; userId: string; role?: number; card?: number; group?: number }) => {
  const b = Buffer.alloc(USER_RECORD_SIZE);
  b.writeUInt16LE(opts.uid, 0);
  b.writeUInt8(opts.role ?? 0, 2);
  b.writeUInt32LE(opts.card ?? 0, 35);
  b.writeUInt8(opts.group ?? 1, 39);
  b.writeUInt8(1, 42); // an unrelated flag that must survive a write
  b.write(opts.userId, 48, "ascii");
  return b;
};

test("user record is parsed field by field", () => {
  const r = parseUserRecord(makeRecord({ uid: 14, userId: "14", card: 5629740 }));
  assert.equal(r.uid, 14);
  assert.equal(r.userId, "14");
  assert.equal(r.cardno, 5629740);
  assert.equal(r.group, 1);
  assert.equal(r.role, 0);
});

test("changing the group changes only that one byte (card number survives)", () => {
  const before = makeRecord({ uid: 14, userId: "14", card: 13469372 });
  const after = withGroup(before, 5);
  assert.equal(after.readUInt8(39), 5);
  assert.equal(after.readUInt32LE(35), 13469372);
  assert.equal(after[42], 1);
  assert.equal(onlyGroupDiffers(before, after), true);
  // the original buffer is untouched
  assert.equal(before.readUInt8(39), 1);

  const corrupted = Buffer.from(after);
  corrupted.writeUInt8(0, 42);
  assert.equal(onlyGroupDiffers(before, corrupted), false);
});

test("blob is split into 72 byte records after the 4 byte header", () => {
  const a = makeRecord({ uid: 1, userId: "1" });
  const b = makeRecord({ uid: 2, userId: "2" });
  const blob = Buffer.concat([Buffer.from([0, 0, 0, 0]), a, b]);
  const records = splitUserBlob(blob);
  assert.equal(records.length, 2);
  assert.equal(parseUserRecord(records[1]!).userId, "2");
});

const decisions = (rows: Array<[string, boolean]>) =>
  new Map<string, TMemberDecision | "ambiguous">(
    rows.map(([key, allowed]) => [
      key,
      { memberRef: `m${key}`, allowed, reason: allowed ? "no_monthly_due" : "monthly_due" },
    ]),
  );

const plan = (users: any[], rows: Array<[string, boolean]>) =>
  planDeviceAccessSync({
    users: users.map((u) => parseUserRecord(makeRecord(u))),
    decisions: decisions(rows),
    blockGroup: 5,
    allowGroup: 1,
  });

test("unpaid member in the normal group is moved to the blocked group", () => {
  const result = plan([{ uid: 6, userId: "6" }], [["6", false]]);
  assert.equal(result.changes.length, 1);
  assert.deepEqual(
    [result.changes[0]!.to, result.changes[0]!.toGroup],
    ["blocked", 5],
  );
});

test("paid member who is currently blocked is moved back", () => {
  const result = plan([{ uid: 6, userId: "6", group: 5 }], [["6", true]]);
  assert.deepEqual(
    [result.changes[0]!.to, result.changes[0]!.toGroup],
    ["allowed", 1],
  );
});

test("nothing to do when the device already matches", () => {
  const result = plan(
    [
      { uid: 1, userId: "1", group: 1 },
      { uid: 2, userId: "2", group: 5 },
    ],
    [["1", true], ["2", false]],
  );
  assert.equal(result.changes.length, 0);
  assert.equal(result.counts.alreadyCorrect, 2);
});

test("staff, device admins and unknown ids are never touched", () => {
  const result = plan(
    [
      { uid: 30, userId: "100001" },
      { uid: 8, userId: "8", role: 14 },
      { uid: 99, userId: "99" },
    ],
    [["100001", false], ["8", false]],
  );
  assert.equal(result.changes.length, 0);
  assert.deepEqual(
    result.skipped.map((s) => s.why),
    ["staff", "device_admin", "unlinked"],
  );
});

test("an id shared by two members is skipped, not guessed", () => {
  const result = planDeviceAccessSync({
    users: [parseUserRecord(makeRecord({ uid: 75, userId: "75" }))],
    decisions: new Map([["75", "ambiguous" as const]]),
    blockGroup: 5,
    allowGroup: 1,
  });
  assert.equal(result.changes.length, 0);
  assert.equal(result.skipped[0]!.why, "ambiguous");
});

test("leading zeros on the device id still match", () => {
  const result = plan([{ uid: 5, userId: "005" }], [["5", false]]);
  assert.equal(result.changes.length, 1);
});

test("safety stop refuses to block most of the gym at once", () => {
  const users = Array.from({ length: 40 }, (_, i) => ({ uid: i + 1, userId: String(i + 1) }));
  const rows = users.map((u) => [u.userId, false] as [string, boolean]);
  const result = plan(users, rows);
  const verdict = assessBlockSafety(result);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.limit, 10);

  const few = plan(users, users.map((u, i) => [u.userId, i >= 5] as [string, boolean]));
  assert.equal(assessBlockSafety(few).ok, true);
});
