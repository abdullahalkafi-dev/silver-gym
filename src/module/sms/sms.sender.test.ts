import assert from "node:assert/strict";
import test from "node:test";
import { resolveSender, roundMoney } from "./sms.sender";

// The two sender IDs and their prices are fixed for the whole app (see sms.sender.ts).
test("masking uses the brand name at Tk 0.53, non-masking the number at Tk 0.35", () => {
  const masking = resolveSender("masking");
  const nonMasking = resolveSender("nonMasking");
  assert.equal(masking.id, "SILVER GYM");
  assert.equal(masking.pricePerSms, 0.53);
  assert.equal(nonMasking.id, "8809640911565");
  assert.equal(nonMasking.pricePerSms, 0.35);
});

test("money is rounded to whole paisa", () => {
  assert.equal(roundMoney(18 * 0.53), 9.54);
  assert.equal(roundMoney(0.1 + 0.2), 0.3);
});
