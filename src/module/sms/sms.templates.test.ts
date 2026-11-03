import assert from "node:assert/strict";
import test from "node:test";
import {
  detectUnicode,
  estimateSmsUnits,
  formatHolidayDates,
  isPlainSmsText,
  renderSmsText,
  sanitizeSmsText,
  SMS_TEMPLATE_LIST,
  SMS_TEMPLATES,
} from "./sms.templates";

test("every fixed template is plain English text, so it never costs Unicode rates", () => {
  for (const template of SMS_TEMPLATE_LIST) {
    assert.equal(isPlainSmsText(template.text), true, template.key);
    const sample = renderSmsText(template.text, template.sample);
    assert.deepEqual(sample.missing, [], template.key);
    assert.equal(detectUnicode(sample.text), false, template.key);
  }
});

test("every placeholder in a template is declared and has a sample value", () => {
  for (const template of SMS_TEMPLATE_LIST) {
    const used = Array.from(template.text.matchAll(/\{(\w+)\}/g)).map((m) => m[1]);
    assert.deepEqual([...new Set(used)].sort(), [...template.placeholders].sort(), template.key);
    for (const key of template.placeholders) {
      assert.ok(template.sample[key], `${template.key} sample ${key}`);
    }
  }
});

test("rendering reports empty values instead of sending a broken message", () => {
  const result = renderSmsText(SMS_TEMPLATES.paymentConfirmation.text, {
    Member_Name: "Rahim",
    Paid_Amount: "  ",
  });
  assert.deepEqual(result.missing, ["Paid_Amount"]);
});

test("sanitize turns dashes and curly quotes into plain characters", () => {
  assert.equal(sanitizeSmsText("Pay soon – Silver Gym — thanks"), "Pay soon - Silver Gym - thanks");
  assert.equal(sanitizeSmsText("“Hi” it’s ok"), '"Hi" it\'s ok');
  assert.equal(isPlainSmsText("–"), false);
});

test("credit estimate: 160 plain / 70 unicode for one part", () => {
  assert.equal(estimateSmsUnits("a".repeat(160)), 1);
  assert.equal(estimateSmsUnits("a".repeat(161)), 2);
  assert.equal(estimateSmsUnits("আ".repeat(70)), 1);
  assert.equal(estimateSmsUnits("আ".repeat(71)), 2);
});

test("holiday date label", () => {
  const d = (iso: string) => new Date(`${iso}T06:00:00+06:00`);
  assert.equal(formatHolidayDates(d("2026-06-16"), d("2026-06-16")), "16 Jun");
  assert.equal(formatHolidayDates(d("2026-06-06"), d("2026-06-08")), "6-8 Jun");
  assert.equal(formatHolidayDates(d("2026-12-30"), d("2027-01-02")), "30 Dec-2 Jan");
});
