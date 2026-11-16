import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  currentFieldValue,
  isSameValue,
  requestFieldsSchema,
  toMemberPayload,
} from "./memberUpdateRequest.fields";

describe("requestFieldsSchema", () => {
  it("accepts a partial request (only the touched field)", () => {
    const r = requestFieldsSchema.safeParse({ address: "House 5, Rampura" });
    assert.equal(r.success, true);
    assert.deepEqual(r.data, { address: "House 5, Rampura" });
  });

  it("never allows the phone number or other locked fields", () => {
    for (const locked of ["contact", "memberId", "currentPackageId", "isActive", "barcode"]) {
      const r = requestFieldsSchema.safeParse({ [locked]: "x" });
      assert.equal(r.success, false, `${locked} must be rejected`);
    }
  });

  it("does not let a member blank a field", () => {
    assert.equal(requestFieldsSchema.safeParse({ address: "   " }).success, false);
    assert.equal(requestFieldsSchema.safeParse({ nid: "" }).success, false);
    assert.equal(requestFieldsSchema.safeParse({ trainingGoals: [] }).success, false);
  });

  it("normalizes the emergency contact phone and rejects bad ones", () => {
    const ok = requestFieldsSchema.safeParse({
      emergencyContact: { relationship: "Brother", contactNumber: "+8801712345678" },
    });
    assert.equal(ok.data?.emergencyContact?.contactNumber, "01712345678");
    assert.equal(
      requestFieldsSchema.safeParse({
        emergencyContact: { relationship: "Brother", contactNumber: "12345" },
      }).success,
      false,
    );
  });

  it("requires height/weight value and unit together", () => {
    assert.equal(requestFieldsSchema.safeParse({ height: { value: 170 } }).success, false);
    assert.equal(
      requestFieldsSchema.safeParse({ height: { value: 170, unit: "cm" } }).success,
      true,
    );
  });
});

describe("currentFieldValue / isSameValue", () => {
  const member = {
    address: "",
    email: undefined,
    dateOfBirth: new Date("1995-03-04T00:00:00.000Z"),
    trainingGoals: ["Yoga", "Cardio Endurance"],
    height: 170,
    heightUnit: "cm",
    emergencyContact: { relationship: "", contactNumber: "" },
  };

  it("treats empty/missing values as null (so a new value is an 'add')", () => {
    assert.equal(currentFieldValue(member, "address"), null);
    assert.equal(currentFieldValue(member, "email"), null);
    assert.equal(currentFieldValue(member, "weight"), null);
    assert.equal(currentFieldValue(member, "emergencyContact"), null);
  });

  it("detects unchanged values regardless of formatting", () => {
    assert.equal(isSameValue("dateOfBirth", currentFieldValue(member, "dateOfBirth"), "1995-03-04"), true);
    assert.equal(
      isSameValue("trainingGoals", currentFieldValue(member, "trainingGoals"), ["Cardio Endurance", "Yoga"]),
      true,
    );
    assert.equal(isSameValue("height", currentFieldValue(member, "height"), { value: 170, unit: "cm" }), true);
    assert.equal(isSameValue("height", currentFieldValue(member, "height"), { value: 171, unit: "cm" }), false);
    assert.equal(isSameValue("address", null, "Dhaka"), false);
  });

  it("compares dates of birth by Bangladesh calendar day", () => {
    // The dashboard saves a picked date as Dhaka midnight = 18:00 UTC of the previous day.
    const savedByDashboard = "1995-03-03T18:00:00.000Z"; // 4 March 1995 in Dhaka
    assert.equal(isSameValue("dateOfBirth", savedByDashboard, "1995-03-04"), true);
    assert.equal(isSameValue("dateOfBirth", savedByDashboard, "1995-03-03"), false);
    assert.equal(isSameValue("dateOfBirth", "1995-03-04T00:00:00.000Z", "1995-03-04"), true);
  });
});

describe("toMemberPayload", () => {
  it("maps grouped fields onto member columns", () => {
    assert.deepEqual(toMemberPayload("height", { value: 170, unit: "cm" }), {
      height: 170,
      heightUnit: "cm",
    });
    assert.deepEqual(toMemberPayload("address", "Dhaka"), { address: "Dhaka" });
  });
});
