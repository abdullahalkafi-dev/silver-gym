import { z } from "zod";

const ENGLISH_SMS_TEXT_PATTERN = /^[\x20-\x7E\r\n]*$/;

const isEnglishSmsText = (value: string) => ENGLISH_SMS_TEXT_PATTERN.test(value);

const routeParamsSchema = z
  .object({
    businessId: z.string().trim().min(1, "businessId is required"),
    branchId: z.string().trim().min(1, "branchId is required"),
  })
  .strict();

const historyQuerySchema = z
  .object({
    page: z.string().optional(),
    limit: z.string().optional(),
    status: z.enum(["simulated", "sent", "blocked", "failed"]).optional(),
    sendMode: z.enum(["manual", "auto"]).optional(),
    searchTerm: z.string().trim().optional(),
  })
  .strict();

const dueDurationSchema = z.enum(["thisMonth", "last2Months", "last3Months", "allDue"]);

const templateCategorySchema = z.enum(["due", "occasion", "promotion", "custom"]);

const deliveryModeSchema = z.literal("masking");

const previewSendDataSchema = z
  .object({
    audience: z.enum(["selected", "due"]).optional(),
    memberIds: z.array(z.string().trim().min(1)).optional(),
    template: z
      .string()
      .trim()
      .min(1, "Template cannot be empty")
      .max(480, "Template must be 480 characters or fewer")
      .refine(
        (value) => isEnglishSmsText(value),
        "SMS text must use English characters only",
      )
      .optional(),
    templateCategory: templateCategorySchema.optional(),
    deliveryMode: deliveryModeSchema.optional(),
    dueDuration: dueDurationSchema.optional(),
    targetDate: z.coerce.date().optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    const audience = data.audience || "selected";
    const templateCategory = audience === "due" ? "due" : data.templateCategory || "custom";

    if (audience === "selected" && (!data.memberIds || data.memberIds.length === 0)) {
      ctx.addIssue({
        code: "custom",
        path: ["memberIds"],
        message: "Select at least one member",
      });
    }

    if (templateCategory === "custom" && !data.template?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["template"],
        message: "Write a custom message before continuing",
      });
    }

    if (templateCategory === "due" && data.template && data.template.length > 160) {
      ctx.addIssue({
        code: "custom",
        path: ["template"],
        message: "Due reminder text must stay within 160 English characters",
      });
    }
  });

const dueMembersQuerySchema = z.object({
  params: routeParamsSchema,
  query: z
    .object({
      targetDate: z.coerce.date().optional(),
      dueDuration: dueDurationSchema.optional(),
      page: z.string().optional(),
      limit: z.string().optional(),
      searchTerm: z.string().trim().optional(),
    })
    .strict(),
});

const balanceDto = z.object({
  params: routeParamsSchema,
});

const previewDto = z.object({
  params: routeParamsSchema,
  data: previewSendDataSchema,
});

const sendDto = z.object({
  params: routeParamsSchema,
  data: previewSendDataSchema,
});

const listHistoryDto = z.object({
  params: routeParamsSchema,
  query: historyQuerySchema,
});

const listMemberHistoryDto = z.object({
  params: routeParamsSchema.extend({
    memberId: z.string().trim().min(1, "memberId is required"),
  }),
  query: historyQuerySchema,
});

export const SmsDto = {
  balance: balanceDto,
  dueMembers: dueMembersQuerySchema,
  preview: previewDto,
  send: sendDto,
  listHistory: listHistoryDto,
  listMemberHistory: listMemberHistoryDto,
};
