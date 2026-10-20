declare const require: (moduleId: string) => any;

const assert = require("node:assert/strict");
const test = require("node:test").test;

import {
  computeAccess,
  computeAccessForBranch,
  isStaffDeviceUserId,
  normalizeMemberId,
} from "./access.policy";

// 2026-11-06 12:00 Dhaka  (= 06:00 UTC)
const at = (day: number) => new Date(Date.UTC(2026, 10, day, 6, 0, 0));

const novemberDue = {
  type: "monthly_due",
  remainingAmount: 1000,
  periodStart: "2026-11-01T06:00:00.000Z",
};

test("normalizeMemberId removes leading zeros on both sides", () => {
  assert.equal(normalizeMemberId("0075"), "75");
  assert.equal(normalizeMemberId(" 075 "), "75");
  assert.equal(normalizeMemberId("75"), "75");
  assert.equal(normalizeMemberId("000"), "0");
  assert.equal(normalizeMemberId(""), "");
  assert.equal(normalizeMemberId(undefined), "");
});

test("device ids from 100000 up are staff", () => {
  assert.equal(isStaffDeviceUserId("100001"), true);
  assert.equal(isStaffDeviceUserId("99999"), false);
  assert.equal(isStaffDeviceUserId("75"), false);
  assert.equal(isStaffDeviceUserId("abc"), false);
});

test("paid member is allowed", () => {
  const result = computeAccess({
    isActive: true,
    enabled: true,
    graceDays: 5,
    ledgerItems: [],
    nextPaymentDate: new Date(Date.UTC(2027, 0, 1, 6)),
    now: at(20),
  });
  assert.equal(result.allowed, true);
  assert.equal(result.status, "allowed");
});

test("unpaid month is allowed through the 6th with 5 grace days, blocked from the 7th", () => {
  const base = { isActive: true, enabled: true, graceDays: 5, ledgerItems: [novemberDue] };

  const onSixth = computeAccess({ ...base, now: at(6) });
  assert.equal(onSixth.allowed, true);
  assert.equal(onSixth.status, "grace");
  assert.equal(onSixth.graceUntil, "2026-11-06");

  const onSeventh = computeAccess({ ...base, now: at(7) });
  assert.equal(onSeventh.allowed, false);
  assert.equal(onSeventh.status, "blocked");
  assert.equal(onSeventh.reason, "monthly_due");
});

test("grace days are configurable per branch", () => {
  const base = { isActive: true, enabled: true, ledgerItems: [novemberDue] };
  assert.equal(computeAccess({ ...base, graceDays: 0, now: at(2) }).allowed, false);
  assert.equal(computeAccess({ ...base, graceDays: 10, now: at(11) }).allowed, true);
  assert.equal(computeAccess({ ...base, graceDays: 10, now: at(12) }).allowed, false);
});

test("admission and package dues never block", () => {
  const result = computeAccess({
    isActive: true,
    enabled: true,
    graceDays: 5,
    ledgerItems: [
      { type: "admission_due", remainingAmount: 4000, periodStart: "2026-09-01T06:00:00.000Z" },
      { type: "package_due", remainingAmount: 2000, periodStart: "2026-09-01T06:00:00.000Z" },
    ],
    nextPaymentDate: new Date(Date.UTC(2027, 2, 1, 6)),
    now: at(20),
  });
  assert.equal(result.allowed, true);
  assert.equal(result.reason, "no_monthly_due");
});

test("a fully paid monthly item (remaining 0) does not block", () => {
  const result = computeAccess({
    isActive: true,
    enabled: true,
    graceDays: 5,
    ledgerItems: [{ ...novemberDue, remainingAmount: 0 }],
    now: at(20),
  });
  assert.equal(result.allowed, true);
});

test("oldest unpaid month decides the grace window", () => {
  const result = computeAccess({
    isActive: true,
    enabled: true,
    graceDays: 5,
    ledgerItems: [
      novemberDue,
      { type: "monthly_due", remainingAmount: 1000, periodStart: "2026-10-01T06:00:00.000Z" },
    ],
    now: at(3),
  });
  assert.equal(result.unpaidSince, "2026-10-01");
  assert.equal(result.allowed, false);
});

test("inactive member is blocked", () => {
  const result = computeAccess({ isActive: false, enabled: true, now: at(3) });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "inactive");
});

test("falls back to nextPaymentDate when the ledger has not caught up", () => {
  const result = computeAccess({
    isActive: true,
    enabled: true,
    graceDays: 5,
    ledgerItems: [],
    nextPaymentDate: new Date(Date.UTC(2026, 10, 1, 6)),
    now: at(10),
  });
  assert.equal(result.allowed, false);
  assert.equal(result.unpaidSince, "2026-11-01");
});

test("override beats every other rule until it expires", () => {
  const blockedMember = {
    isActive: false,
    enabled: true,
    graceDays: 5,
    ledgerItems: [novemberDue],
  };

  const allowed = computeAccess({
    ...blockedMember,
    accessOverride: { mode: "allow", until: null },
    now: at(20),
  });
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.reason, "override_allow");

  const expired = computeAccess({
    ...blockedMember,
    accessOverride: { mode: "allow", until: at(10) },
    now: at(20),
  });
  assert.equal(expired.allowed, false);

  const blockedPaid = computeAccess({
    isActive: true,
    enabled: true,
    accessOverride: { mode: "block" },
    now: at(20),
  });
  assert.equal(blockedPaid.allowed, false);
  assert.equal(blockedPaid.reason, "override_block");
});

test("log-only mode never blocks but reports what would happen", () => {
  const result = computeAccessForBranch({
    isActive: true,
    enabled: false,
    graceDays: 5,
    ledgerItems: [novemberDue],
    now: at(20),
  });
  assert.equal(result.allowed, true);
  assert.equal(result.status, "log_only");
  assert.equal(result.wouldBe, "blocked");
});
