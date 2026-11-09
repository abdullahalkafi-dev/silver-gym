import assert from "node:assert/strict";
import test from "node:test";
import {
  CUSTOM_MESSAGE_MAX_CHARS,
  SMS_MAX_CREDITS_CUSTOM,
  SMS_MAX_CREDITS_TEMPLATE,
  singleSmsLimit,
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

// ───────────── CREDIT LOCK ─────────────
// If you change a template's wording and one of these numbers changes, this test
// fails on purpose: it forces a conscious decision about the SMS cost.

const WORST_VALUES = {
  Due_Period: "September 2025-October 2026",
  Due_Amount: "9,999,999",
  Paid_Amount: "9,999,999",
  Holiday_Date: "30 Dec-30 Jan",
  Reason: "R".repeat(40),
};
const LONG_ENGLISH_NAME = "Mohammad Abdullah Al Mamun Hossain Chowdhury"; // 44 characters
const BANGLA_NAME = "মোহাম্মদ আব্দুল্লাহ আল মামুন"; // 28 characters

const creditsWith = (key: keyof typeof SMS_TEMPLATES, name: string) =>
  estimateSmsUnits(renderSmsText(SMS_TEMPLATES[key].text, { ...WORST_VALUES, Member_Name: name }).text);

test("credit lock: every template costs exactly 1 credit with the sample (normal English) values", () => {
  for (const template of SMS_TEMPLATE_LIST) {
    const rendered = renderSmsText(template.text, template.sample).text;
    assert.equal(estimateSmsUnits(rendered), 1, template.key);
  }
});

test("credit lock: a very long English name still costs 1 credit for every template", () => {
  for (const template of SMS_TEMPLATE_LIST) {
    assert.equal(creditsWith(template.key, LONG_ENGLISH_NAME), 1, template.key);
  }
});

test("credit lock: a 28-character Bangla name (Unicode, 70 per part) - exact cost per template", () => {
  const expected = {
    dueReminder: 3, // above SMS_MAX_CREDITS_TEMPLATE, so the app skips it instead of sending
    holiday: 1, // has no name in it
    birthday: 2,
    paymentConfirmation: 2,
    membershipExpired: 2,
    welcome: 2,
  } as const;
  for (const template of SMS_TEMPLATE_LIST) {
    assert.equal(creditsWith(template.key, BANGLA_NAME), expected[template.key], template.key);
  }
});

test("credit lock: custom limit is one SMS (160), and no template is allowed more than 2 credits", () => {
  assert.equal(CUSTOM_MESSAGE_MAX_CHARS, 160);
  assert.equal(SMS_MAX_CREDITS_CUSTOM, 1);
  assert.equal(SMS_MAX_CREDITS_TEMPLATE, 2);
  assert.equal(singleSmsLimit(false), 160);
  assert.equal(singleSmsLimit(true), 70);
});
