import { z } from "zod";

import { PLAN_LIMITS, PLAN_REQUEST_STATUSES } from "./trainerPlan.constants";

const objectId = (label: string) =>
  z.string().regex(/^[a-f\d]{24}$/i, `Invalid ${label}`);

const optionalNumber = (label: string, max: number) =>
  z
    .number({ error: `${label} must be a number` })
    .positive(`${label} must be more than 0`)
    .max(max, `${label} looks too large`)
    .optional();

/** Member asks a trainer. */
export const createPlanRequestDto = z.object({
  body: z
    .object({
      trainerId: objectId("trainer"),
      topic: z
        .string()
        .trim()
        .min(1, "Please choose what you need")
        .max(PLAN_LIMITS.customTopic, `Title can be at most ${PLAN_LIMITS.customTopic} characters`),
      isCustomTopic: z.boolean().optional(),
      note: z
        .string()
        .trim()
        .max(PLAN_LIMITS.note, `Please keep it under ${PLAN_LIMITS.note} characters`)
        .optional(),
      height: optionalNumber("Height", 300),
      heightUnit: z.enum(["cm", "in", "ft"]).optional(),
      weight: optionalNumber("Weight", 700),
      weightUnit: z.enum(["kg", "lb"]).optional(),
    })
    .strict(),
});

const statusFilter = z.enum([...PLAN_REQUEST_STATUSES, "all"]).optional();
const page = z.string().regex(/^\d+$/).optional();

/** Trainer inbox filters. */
export const trainerListDto = z.object({
  query: z
    .object({
      status: statusFilter,
      topic: z.string().trim().max(PLAN_LIMITS.customTopic).optional(),
      search: z.string().trim().max(60).optional(),
      page,
      limit: page,
    })
    .strict(),
});

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

/** Dashboard filters for one trainer. */
export const staffListDto = z.object({
  query: z
    .object({
      status: statusFilter,
      topic: z.string().trim().max(PLAN_LIMITS.customTopic).optional(),
      search: z.string().trim().max(60).optional(),
      from: day.optional(),
      to: day.optional(),
      page,
      limit: page,
    })
    .strict(),
});

const content = z
  .string()
  .max(PLAN_LIMITS.content, "This plan is too long. Please shorten it.");

export const replyDto = z.object({
  body: z
    .object({
      title: z.string().trim().max(PLAN_LIMITS.title).optional(),
      content,
    })
    .strict(),
});

export const declineDto = z.object({
  body: z
    .object({
      reason: z
        .string()
        .trim()
        .min(1, "Please write a short reason")
        .max(PLAN_LIMITS.declineReason),
    })
    .strict(),
});

export const templateDto = z.object({
  body: z
    .object({
      title: z
        .string()
        .trim()
        .min(1, "Title is required")
        .max(PLAN_LIMITS.title, `Title can be at most ${PLAN_LIMITS.title} characters`),
      content,
    })
    .strict(),
});

export const templateUpdateDto = z.object({
  body: templateDto.shape.body.partial(),
});
