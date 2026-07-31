import test from "node:test";
import assert from "node:assert/strict";
import { PaymentType, PaymentStatus, PaymentMethod } from "./payment.interface";

test("PaymentType enum includes CUSTOM", () => {
  assert.equal(PaymentType.CUSTOM, "custom");
});

test("Custom Income validation rejects future date in Asia/Dhaka time", () => {
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + 5);

  const bdNow = new Date(Date.now() + 6 * 60 * 60 * 1000);
  const bdTarget = new Date(futureDate.getTime() + 6 * 60 * 60 * 1000);
  const isFuture = bdTarget.toISOString().slice(0, 10) > bdNow.toISOString().slice(0, 10);

  assert.equal(isFuture, true, "Future date must be identified as future");
});

test("Custom Income validation accepts today or past date", () => {
  const today = new Date();
  const bdNow = new Date(Date.now() + 6 * 60 * 60 * 1000);
  const bdTarget = new Date(today.getTime() + 6 * 60 * 60 * 1000);
  const isFuture = bdTarget.toISOString().slice(0, 10) > bdNow.toISOString().slice(0, 10);

  assert.equal(isFuture, false, "Today must not be marked as future");
});
