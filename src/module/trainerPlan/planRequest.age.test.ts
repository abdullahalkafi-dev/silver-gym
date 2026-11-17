import { test } from "node:test";
import assert from "node:assert/strict";

import { ageOn } from "./planRequest.service";

// The dashboard stores a picked birthday as Dhaka midnight = 18:00 UTC the day before.
const dhakaMidnight = (ymd: string) => new Date(`${ymd}T00:00:00+06:00`);

test("age counts the birthday by Bangladesh calendar day", () => {
  const dob = dhakaMidnight("2000-11-17");
  assert.equal(ageOn(dob, dhakaMidnight("2026-11-16")), 25);
  assert.equal(ageOn(dob, dhakaMidnight("2026-11-17")), 26);
});

test("missing or broken dates give no age", () => {
  assert.equal(ageOn(null), undefined);
  assert.equal(ageOn("not a date"), undefined);
});
