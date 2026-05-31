declare const require: (moduleId: string) => any;

const assert = require("node:assert/strict");
const test = require("node:test").test;

import {
  buildAutoDeactivationUpdate,
  evaluateMemberAutoDeactivation,
} from "./member.autoDeactivation";

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

test("auto-deactivation waits until the overdue threshold is fully reached", () => {
  const member = {
    currentDueAmount: 0,
    nextPaymentDate: new Date(2026, 0, 1),
    isActive: true,
    isCustomMonthlyFee: true,
    customMonthlyFeeAmount: 500,
    metadata: {},
    fullName: "Threshold Member",
    memberId: "M-100",
  };
  const branch = {
    branchName: "Main Branch",
    monthlyFeeAmount: 500,
    autoDeactivateAfterUnpaidMonths: 6,
  };

  const beforeThreshold = evaluateMemberAutoDeactivation(
    member,
    branch,
    new Date(2026, 5, 30),
  );
  const atThreshold = evaluateMemberAutoDeactivation(
    member,
    branch,
    new Date(2026, 6, 15),
  );

  assert.equal(beforeThreshold.billing.overdueMonths, 5);
  assert.equal(beforeThreshold.shouldDeactivate, false);
  assert.equal(atThreshold.billing.overdueMonths, 6);
  assert.equal(atThreshold.shouldDeactivate, true);
});

test("auto-deactivation falls back to the default 6-month threshold when branch value is missing", () => {
  const member = {
    currentDueAmount: 0,
    nextPaymentDate: new Date(2026, 0, 1),
    isActive: true,
    isCustomMonthlyFee: true,
    customMonthlyFeeAmount: 500,
    metadata: {},
    fullName: "Default Threshold Member",
    memberId: "M-101",
  };
  const branch = {
    branchName: "Legacy Branch",
    monthlyFeeAmount: 500,
  };

  const evaluation = evaluateMemberAutoDeactivation(
    member,
    branch,
    new Date(2026, 6, 15),
  );

  assert.equal(evaluation.thresholdMonths, 6);
  assert.equal(evaluation.shouldDeactivate, true);
});

test("auto-deactivation update freezes accrual and persists reconciled billing", () => {
  const member = {
    currentDueAmount: 0,
    nextPaymentDate: new Date(2026, 2, 1),
    isActive: true,
    isCustomMonthlyFee: true,
    customMonthlyFeeAmount: 500,
    metadata: {},
    fullName: "Freeze Member",
    memberId: "M-102",
  };
  const branch = {
    branchName: "Main Branch",
    monthlyFeeAmount: 500,
    autoDeactivateAfterUnpaidMonths: 2,
  };

  const result = buildAutoDeactivationUpdate(
    member,
    branch,
    new Date(2026, 4, 15),
  );

  assert.ok(result);
  const updatePayload = result?.updatePayload as {
    isActive: boolean;
    currentDueAmount: number;
    nextPaymentDate?: Date;
    metadata: {
      billingProfile?: { accrualStoppedAt?: string };
    };
  };

  assert.equal(result?.billing.overdueMonths, 2);
  assert.equal(updatePayload.isActive, false);
  assert.equal(updatePayload.currentDueAmount, 1000);
  assert.ok(updatePayload.metadata.billingProfile?.accrualStoppedAt);
  assertLocalDate(updatePayload.nextPaymentDate, 2026, 4, 1);
});