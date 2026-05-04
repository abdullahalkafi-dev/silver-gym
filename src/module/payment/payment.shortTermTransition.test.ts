declare const require: (moduleId: string) => any;

const assert = require("node:assert/strict");
const test = require("node:test").test;

import { resolveShortTermMonthlyTransition } from "./payment.shortTermTransition";

const assertLocalDate = (
  value: Date | undefined,
  year: number,
  monthIndex: number,
  dayOfMonth: number,
) => {
  assert.ok(value);
  const nextValue = value as Date;
  assert.equal(nextValue.getFullYear(), year);
  assert.equal(nextValue.getMonth(), monthIndex);
  assert.equal(nextValue.getDate(), dayOfMonth);
};

test("short-term package deactivates on expiry day and anchors monthly to the month start", () => {
  const transition = resolveShortTermMonthlyTransition({
    currentPackageDurationType: "day",
    membershipStartDate: new Date(2026, 4, 6),
    membershipEndDate: new Date(2026, 4, 13),
    monthlyFeeAmount: 1000,
    isActive: true,
    now: new Date(2026, 4, 13),
  });

  assert.equal(transition.shouldDeactivateMember, true);
  assert.equal(transition.canTransitionToMonthly, true);
  assertLocalDate(transition.expiryDate, 2026, 4, 13);
  assertLocalDate(transition.monthlyAnchorDate, 2026, 4, 1);
  assert.equal(transition.coveredDaysInAnchorMonth, 7);
  assert.equal(transition.daysInAnchorMonth, 31);
  assert.equal(transition.suggestedDiscountAmount, 225.81);
});

test("short-term transition credits only the covered days inside the expiry month", () => {
  const transition = resolveShortTermMonthlyTransition({
    currentPackageDurationType: "day",
    membershipStartDate: new Date(2026, 4, 29),
    membershipEndDate: new Date(2026, 5, 5),
    monthlyFeeAmount: 1000,
    isActive: true,
    now: new Date(2026, 5, 5),
  });

  assert.equal(transition.shouldDeactivateMember, true);
  assert.equal(transition.canTransitionToMonthly, true);
  assertLocalDate(transition.monthlyAnchorDate, 2026, 5, 1);
  assert.equal(transition.coveredDaysInAnchorMonth, 4);
  assert.equal(transition.daysInAnchorMonth, 30);
  assert.equal(transition.suggestedDiscountAmount, 133.33);
});

test("short-term package does not offer monthly transition before expiry day", () => {
  const transition = resolveShortTermMonthlyTransition({
    currentPackageDurationType: "week",
    membershipStartDate: new Date(2026, 4, 6),
    membershipEndDate: new Date(2026, 4, 13),
    monthlyFeeAmount: 1000,
    isActive: true,
    now: new Date(2026, 4, 12),
  });

  assert.equal(transition.shouldDeactivateMember, false);
  assert.equal(transition.canTransitionToMonthly, false);
  assertLocalDate(transition.expiryDate, 2026, 4, 13);
  assertLocalDate(transition.monthlyAnchorDate, 2026, 4, 1);
  assert.equal(transition.suggestedDiscountAmount, undefined);
});