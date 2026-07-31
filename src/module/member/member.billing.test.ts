declare const require: (moduleId: string) => any;

const assert = require("node:assert/strict");
const test = require("node:test").test;

import {
  applyBillingToMember,
  calculateMonthlyCycleEndDate,
  mergeMemberBillingProfileMetadata,
  reconcileMemberBillingState,
  resolveReactivatedNextPaymentDate,
} from "./member.billing";
import { reconcileMemberBillingLedger } from "./member.billingLedger";

const branch = { monthlyFeeAmount: 500 };

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

test("multi-month join keeps the next bill at the first unpaid month", () => {
  const endDate = calculateMonthlyCycleEndDate(new Date(2026, 4, 1), 2);

  assertLocalDate(endDate, 2026, 6, 1);
});

test("mid-month join anchors cycle end to first of next month", () => {
  const endDate = calculateMonthlyCycleEndDate(new Date(2026, 5, 20), 1);
  assertLocalDate(endDate, 2026, 6, 1); // July 1
});

test("multi-month mid-month join anchors correctly to 1st of target month", () => {
  const endDate = calculateMonthlyCycleEndDate(new Date(2026, 5, 20), 3);
  assertLocalDate(endDate, 2026, 8, 1); // Sept 1
});

test("missed months generate one monthly due item per unpaid month", () => {
  const member = {
    currentDueAmount: 0,
    nextPaymentDate: new Date(2026, 6, 1),
    isActive: true,
    isCustomMonthlyFee: true,
    customMonthlyFeeAmount: 500,
    metadata: {},
  };

  const billing = reconcileMemberBillingState(member, branch, new Date(2026, 10, 5));
  const ledger = reconcileMemberBillingLedger(
    member,
    billing,
    new Date(2026, 10, 5),
  );

  const monthlyDueItems = ledger.items.filter((item) => item.type === "monthly_due");

  assert.equal(billing.overdueMonths, 4);
  assert.equal(billing.currentDueAmount, 2000);
  assertLocalDate(billing.updatedNextPaymentDate, 2026, 10, 1);
  assert.deepEqual(
    monthlyDueItems.map((item) => item.key),
    [
      "monthly_due:2026-07",
      "monthly_due:2026-08",
      "monthly_due:2026-09",
      "monthly_due:2026-10",
    ],
  );
});

test("inactive freeze preserves dues earned before the inactive month boundary", () => {
  const member = {
    currentDueAmount: 0,
    nextPaymentDate: new Date(2026, 6, 1),
    isActive: false,
    isCustomMonthlyFee: true,
    customMonthlyFeeAmount: 500,
    metadata: mergeMemberBillingProfileMetadata({}, {
      cycleType: "monthly",
      accrualStoppedAt: "2026-09-15T00:00:00.000Z",
    }),
  };

  const billing = reconcileMemberBillingState(member, branch, new Date(2026, 11, 5));

  assert.equal(billing.overdueMonths, 3);
  assert.equal(billing.currentDueAmount, 1500);
  assertLocalDate(billing.updatedNextPaymentDate, 2026, 9, 1);
});

test("reactivation resumes from the current month instead of backfilling paused months", () => {
  const resumedDate = resolveReactivatedNextPaymentDate(
    "2026-10-01T00:00:00.000Z",
    new Date(2026, 11, 5),
  );
  const futureDate = resolveReactivatedNextPaymentDate(
    "2027-01-01T00:00:00.000Z",
    new Date(2026, 11, 5),
  );

  assertLocalDate(resumedDate, 2026, 11, 1);
  assertLocalDate(futureDate, 2027, 0, 1);
});

test("package-to-monthly continuation accrues dues from the stored monthly rate after expiry", () => {
  const member = {
    currentDueAmount: 0,
    nextPaymentDate: new Date(2026, 7, 1),
    isActive: true,
    isCustomMonthlyFee: true,
    customMonthlyFeeAmount: 800,
    metadata: mergeMemberBillingProfileMetadata({}, {
      cycleType: "package",
    }),
  };

  const billing = reconcileMemberBillingState(member, branch, new Date(2026, 9, 5));

  assert.equal(billing.overdueMonths, 2);
  assert.equal(billing.currentDueAmount, 1600);
  assertLocalDate(billing.updatedNextPaymentDate, 2026, 9, 1);
});

test("stored recurring monthly fee snapshot prevents retroactive branch fee drift", () => {
  const member = {
    currentDueAmount: 0,
    nextPaymentDate: new Date(2026, 6, 1),
    isActive: true,
    isCustomMonthlyFee: false,
    customMonthlyFeeAmount: undefined,
    metadata: mergeMemberBillingProfileMetadata({}, {
      cycleType: "monthly",
      recurringMonthlyFeeAmount: 500,
    }),
  };

  const billing = reconcileMemberBillingState(
    member,
    { monthlyFeeAmount: 700 },
    new Date(2026, 8, 5),
  );

  assert.equal(billing.overdueMonths, 2);
  assert.equal(billing.currentDueAmount, 1000);
  assert.equal(billing.monthlyFeeAmount, 500);
  assertLocalDate(billing.updatedNextPaymentDate, 2026, 8, 1);
});

test("monthly due is added when the next month begins, not before month end", () => {
  const member = {
    currentDueAmount: 0,
    nextPaymentDate: new Date(2026, 5, 1),
    isActive: true,
    isCustomMonthlyFee: true,
    customMonthlyFeeAmount: 500,
    metadata: {},
  };

  const beforeMonthRoll = reconcileMemberBillingState(
    member,
    branch,
    new Date(2026, 5, 30),
  );
  const afterMonthRoll = reconcileMemberBillingState(
    member,
    branch,
    new Date(2026, 6, 1),
  );

  assert.equal(beforeMonthRoll.overdueMonths, 0);
  assert.equal(beforeMonthRoll.currentDueAmount, 0);
  assertLocalDate(beforeMonthRoll.updatedNextPaymentDate, 2026, 5, 1);

  assert.equal(afterMonthRoll.overdueMonths, 1);
  assert.equal(afterMonthRoll.currentDueAmount, 500);
  assertLocalDate(afterMonthRoll.updatedNextPaymentDate, 2026, 6, 1);
});

test("monthly due waits until March 1 even in leap-year February", () => {
  const member = {
    currentDueAmount: 0,
    nextPaymentDate: new Date(2028, 1, 1),
    isActive: true,
    isCustomMonthlyFee: true,
    customMonthlyFeeAmount: 500,
    metadata: {},
  };

  const leapDaySnapshot = reconcileMemberBillingState(
    member,
    branch,
    new Date(2028, 1, 29, 23, 59, 59),
  );
  const marchBoundarySnapshot = reconcileMemberBillingState(
    member,
    branch,
    new Date(2028, 2, 1, 0, 0, 0),
  );

  assert.equal(leapDaySnapshot.overdueMonths, 0);
  assert.equal(leapDaySnapshot.currentDueAmount, 0);
  assertLocalDate(leapDaySnapshot.updatedNextPaymentDate, 2028, 1, 1);

  assert.equal(marchBoundarySnapshot.overdueMonths, 1);
  assert.equal(marchBoundarySnapshot.currentDueAmount, 500);
  assertLocalDate(marchBoundarySnapshot.updatedNextPaymentDate, 2028, 2, 1);
});

test("monthly due waits until January 1 at year rollover", () => {
  const member = {
    currentDueAmount: 0,
    nextPaymentDate: new Date(2026, 11, 1),
    isActive: true,
    isCustomMonthlyFee: true,
    customMonthlyFeeAmount: 500,
    metadata: {},
  };

  const endOfYearSnapshot = reconcileMemberBillingState(
    member,
    branch,
    new Date(2026, 11, 31, 23, 59, 59),
  );
  const newYearSnapshot = reconcileMemberBillingState(
    member,
    branch,
    new Date(2027, 0, 1, 0, 0, 0),
  );

  assert.equal(endOfYearSnapshot.overdueMonths, 0);
  assert.equal(endOfYearSnapshot.currentDueAmount, 0);
  assertLocalDate(endOfYearSnapshot.updatedNextPaymentDate, 2026, 11, 1);

  assert.equal(newYearSnapshot.overdueMonths, 1);
  assert.equal(newYearSnapshot.currentDueAmount, 500);
  assertLocalDate(newYearSnapshot.updatedNextPaymentDate, 2027, 0, 1);
});

test("persisted boundary state does not add the same monthly due twice in one month", () => {
  const member = {
    currentDueAmount: 0,
    nextPaymentDate: new Date(2026, 5, 1),
    isActive: true,
    isCustomMonthlyFee: true,
    customMonthlyFeeAmount: 500,
    metadata: {},
  };

  const boundaryBilling = reconcileMemberBillingState(
    member,
    branch,
    new Date(2026, 6, 1, 0, 0, 0),
  );
  const persistedMember = applyBillingToMember(member, boundaryBilling);
  const repeatReadBilling = reconcileMemberBillingState(
    persistedMember,
    branch,
    new Date(2026, 6, 20, 12, 0, 0),
  );

  assert.equal(boundaryBilling.overdueMonths, 1);
  assert.equal(boundaryBilling.currentDueAmount, 500);
  assertLocalDate(boundaryBilling.updatedNextPaymentDate, 2026, 6, 1);

  assert.equal(repeatReadBilling.overdueMonths, 0);
  assert.equal(repeatReadBilling.currentDueAmount, 500);
  assertLocalDate(repeatReadBilling.updatedNextPaymentDate, 2026, 6, 1);
  assert.equal(repeatReadBilling.shouldPersist, false);
});