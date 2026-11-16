import { z } from "zod";

import { normalizeBangladeshPhone } from "../../utils/bangladeshPhone";

/**
 * Fields a member may ask to change from the portal.
 *
 * NOT allowed (never accepted, the schema is strict): contact/phone, memberId, barcode,
 * branch, package, fees, status, billing data.
 *
 * A member can only ADD or CHANGE a value, never blank one out, so every text
 * field must be non-empty when it is present.
 */
export const TRAINING_GOALS = [
  "Yoga",
  "Cardio Endurance",
  "Bodybuilding",
  "Muscle Gain",
  "Flexibility & Mobility",
  "General Fitness",
  "Strength Training",
] as const;

const text = (max = 200) => z.string().trim().min(1, "Cannot be empty").max(max);

const phoneSchema = z
  .string()
  .trim()
  .min(1, "Emergency contact number is required")
  .transform((value, ctx) => {
    const normalized = normalizeBangladeshPhone(value);
    if (!normalized) {
      ctx.addIssue({
        code: "custom",
        message: "Emergency contact number must be a valid Bangladesh mobile number",
      });
      return z.NEVER;
    }
    return normalized;
  });

export const requestFieldsSchema = z
  .object({
    fullName: text(100),
    email: z.email("Invalid email").trim().toLowerCase(),
    dateOfBirth: z.coerce
      .date()
      .refine((d) => d.getTime() < Date.now(), "Date of birth must be in the past"),
    country: text(60),
    nid: text(30),
    gender: text(20),
    bloodGroup: text(10),
    address: text(300),
    height: z
      .object({
        value: z.number().positive().max(1000),
        unit: z.enum(["cm", "in", "ft"]),
      })
      .strict(),
    weight: z
      .object({
        value: z.number().positive().max(1000),
        unit: z.enum(["kg", "lb"]),
      })
      .strict(),
    emergencyContact: z
      .object({
        relationship: text(60),
        contactNumber: phoneSchema,
      })
      .strict(),
    trainingGoals: z.array(z.enum(TRAINING_GOALS)).min(1).max(TRAINING_GOALS.length),
  })
  .partial()
  .strict();

export type TRequestFields = z.infer<typeof requestFieldsSchema>;
export type TRequestFieldKey = keyof TRequestFields;

export const REQUEST_FIELD_KEYS = Object.keys(requestFieldsSchema.shape) as TRequestFieldKey[];

// The calendar day in Bangladesh time. The dashboard saves a picked date as local (Dhaka) midnight,
// which is 18:00 UTC of the day before, so comparing UTC days would be off by one for those members.
const dateKey = (value: unknown) => {
  if (!value) return "";
  const d = new Date(value as string | number | Date);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-CA", { timeZone: "Asia/Dhaka" });
};

/** Reads the member's current value for a request field, in the same shape as requests use. */
export const currentFieldValue = (
  member: Record<string, any>,
  key: TRequestFieldKey,
): unknown => {
  switch (key) {
    case "height":
      return member.height != null && member.heightUnit
        ? { value: member.height, unit: member.heightUnit }
        : null;
    case "weight":
      return member.weight != null && member.weightUnit
        ? { value: member.weight, unit: member.weightUnit }
        : null;
    case "dateOfBirth":
      return member.dateOfBirth ? new Date(member.dateOfBirth).toISOString() : null;
    case "emergencyContact":
      return member.emergencyContact?.contactNumber || member.emergencyContact?.relationship
        ? {
            relationship: member.emergencyContact?.relationship ?? "",
            contactNumber: member.emergencyContact?.contactNumber ?? "",
          }
        : null;
    case "trainingGoals":
      return Array.isArray(member.trainingGoals) && member.trainingGoals.length
        ? [...member.trainingGoals]
        : null;
    default: {
      const value = member[key];
      return typeof value === "string" && value.trim() ? value : null;
    }
  }
};

/** Stable comparison so "same value, different formatting" is not treated as a change. */
export const isSameValue = (key: TRequestFieldKey, a: unknown, b: unknown): boolean => {
  if (a == null || b == null) return a == null && b == null;

  switch (key) {
    case "dateOfBirth":
      return dateKey(a) === dateKey(b);
    case "trainingGoals":
      return (
        [...(a as string[])].sort().join("|") === [...(b as string[])].sort().join("|")
      );
    case "height":
    case "weight":
    case "emergencyContact":
      return JSON.stringify(a) === JSON.stringify(b);
    default:
      return String(a).trim() === String(b).trim();
  }
};

/** Maps one accepted request field onto the member document fields. */
export const toMemberPayload = (
  key: TRequestFieldKey,
  value: any,
): Record<string, unknown> => {
  switch (key) {
    case "height":
      return { height: value.value, heightUnit: value.unit };
    case "weight":
      return { weight: value.value, weightUnit: value.unit };
    case "dateOfBirth":
      return { dateOfBirth: new Date(value) };
    default:
      return { [key]: value };
  }
};
