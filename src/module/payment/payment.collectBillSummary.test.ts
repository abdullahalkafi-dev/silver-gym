declare const require: (moduleId: string) => any;

const assert = require("node:assert/strict");
const test = require("node:test").test;

import { summarizeCollectBillResolution } from "./payment.collectBillSummary";

test("collect-bill summary separates waived old dues from cycle discount", () => {
  const summary = summarizeCollectBillResolution([
    {
      kind: "selected_due",
      lineType: "monthly_due",
      label: "Jul 2026",
      amount: 500,
      discountAppliedAmount: 500,
      paidAppliedAmount: 0,
    },
    {
      kind: "selected_due",
      lineType: "monthly_due",
      label: "Aug 2026",
      amount: 500,
      discountAppliedAmount: 0,
      paidAppliedAmount: 300,
    },
    {
      kind: "cycle",
      lineType: "monthly_cycle",
      label: "Future monthly payment",
      amount: 600,
      discountAppliedAmount: 100,
      paidAppliedAmount: 500,
    },
  ]);

  assert.equal(summary.waivedDueAmount, 500);
  assert.equal(summary.waivedDueItemCount, 1);
  assert.deepEqual(summary.waivedDueLabels, ["Jul 2026"]);
  assert.equal(summary.paidDueAmount, 300);
  assert.equal(summary.paidDueItemCount, 1);
  assert.equal(summary.discountedCycleAmount, 100);
  assert.equal(summary.paidCycleAmount, 500);
  assert.equal(summary.cycleChargeAmount, 600);
});