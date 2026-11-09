import { z } from "zod";
import { HOLIDAY_REASONS } from "./sms.templates";

const routeParamsSchema = z
  .object({
    businessId: z.string().trim().min(1, "businessId is required"),
    branchId: z.string().trim().min(1, "branchId is required"),
  })
  .strict();

const dueDurationSchema = z.enum(["thisMonth", "last2Months", "last3Months", "allDue"]);
const templateKeySchema = z.enum([
  "dueReminder",
  "holiday",
  "birthday",
  "paymentConfirmation",
  "membershipExpired",
  "welcome",
]);

const historyQuerySchema = z
  .object({
    page: z.string().optional(),
    limit: z.string().optional(),
    status: z.enum(["simulated", "sent", "blocked", "failed", "skipped"]).optional(),
    templateKey: z.string().trim().optional(),
    requestId: z.string().trim().optional(),
    searchTerm: z.string().trim().optional(),
  })
  .strict();

const sendDataSchema = z
  .object({
    kind: z.enum(["dueReminder", "holiday", "custom"]),
    audience: z.enum(["selected", "active", "inactive", "all"]).optional(),
    memberIds: z.array(z.string().trim().min(1)).max(5000).optional(),
    dueDuration: dueDurationSchema.optional(),
    targetDate: z.coerce.date().optional(),
    message: z.string().max(600).optional(),
    holidayId: z.string().trim().optional(),
  })
  .strict();

const emptyParams = z.object({ params: routeParamsSchema });

const hour = z.number().int().min(9).max(20);

export const SmsDto = {
  balance: emptyParams,
  settings: emptyParams,
  holidays: emptyParams,
  dueMembers: z.object({
    params: routeParamsSchema,
    query: z
      .object({ targetDate: z.coerce.date().optional(), dueDuration: dueDurationSchema.optional() })
      .strict(),
  }),
  updateSettings: z.object({
    params: routeParamsSchema,
    data: z
      .object({
        enabled: z.boolean().optional(),
        senderType: z.enum(["masking", "nonMasking"]).optional(),
        // Old screens may still send this. The sender IDs are fixed for the whole app now, so it is ignored.
        maskingSender: z.unknown().optional(),
        reminderDayOfMonth: z.number().int().min(1).max(31).optional(),
        reminderHour: hour.optional(),
        birthdayHour: hour.optional(),
        toggles: z
          .object({
            dueReminder: z.boolean().optional(),
            birthday: z.boolean().optional(),
            paymentConfirmation: z.boolean().optional(),
            membershipExpired: z.boolean().optional(),
            welcome: z.boolean().optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .refine((data) => Object.keys(data).length > 0, "Nothing to update"),
  }),
  preview: z.object({ params: routeParamsSchema, data: sendDataSchema }),
  send: z.object({ params: routeParamsSchema, data: sendDataSchema }),
  test: z.object({
    params: routeParamsSchema,
    data: z
      .object({ templateKey: templateKeySchema, phone: z.string().trim().min(5).max(20) })
      .strict(),
  }),
  createHoliday: z.object({
    params: routeParamsSchema,
    data: z
      .object({
        fromDate: z.coerce.date(),
        toDate: z.coerce.date().optional(),
        reason: z.enum([...HOLIDAY_REASONS, "Other"]),
        otherReason: z.string().trim().max(80).optional(),
        includeInactive: z.boolean().optional(),
      })
      .strict(),
  }),
  deleteHoliday: z.object({
    params: routeParamsSchema.extend({ holidayId: z.string().trim().min(1) }),
  }),
  listHistory: z.object({ params: routeParamsSchema, query: historyQuerySchema }),
  listMemberHistory: z.object({
    params: routeParamsSchema.extend({ memberId: z.string().trim().min(1) }),
    query: historyQuerySchema,
  }),
  retry: z.object({
    params: routeParamsSchema.extend({ requestId: z.string().trim().min(1) }),
  }),
};
