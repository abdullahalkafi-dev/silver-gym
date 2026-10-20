import { z } from "zod";

const updateSettings = z.object({
  data: z
    .object({
      enabled: z.boolean().optional(),
      graceDays: z
        .number()
        .int("Grace days must be a whole number")
        .min(0, "Grace days cannot be negative")
        .max(31, "Grace days cannot be more than 31")
        .optional(),
      debounceMinutes: z.number().int().min(0).max(60).optional(),
    })
    .strict(),
});

const createDevice = z.object({
  data: z
    .object({
      name: z.string().trim().min(1, "Device name is required").max(80),
      host: z
        .string()
        .trim()
        .min(1, "Device host is required")
        .max(255)
        .regex(/^[A-Za-z0-9.\-]+$/, "Host may only contain letters, digits, dots and dashes"),
      port: z.number().int().min(1).max(65535),
      deviceModel: z.string().trim().max(80).optional(),
    })
    .strict(),
});

const updateDevice = z.object({
  data: z
    .object({
      name: z.string().trim().min(1).max(80).optional(),
      host: z
        .string()
        .trim()
        .min(1)
        .max(255)
        .regex(/^[A-Za-z0-9.\-]+$/)
        .optional(),
      port: z.number().int().min(1).max(65535).optional(),
      isActive: z.boolean().optional(),
      writeEnabled: z.boolean().optional(),
      blockGroup: z.number().int().min(0).max(255).nullable().optional(),
      allowGroup: z.number().int().min(0).max(255).optional(),
    })
    .strict(),
});

const memberOverride = z.object({
  data: z
    .object({
      mode: z.enum(["allow", "block"]).nullable(),
      until: z.string().datetime().nullable().optional(),
      reason: z.string().trim().max(200).optional(),
    })
    .strict(),
});

const testUser = z.object({
  data: z
    .object({
      memberRef: z.string().min(1).optional(),
      memberId: z.string().min(1).optional(),
      state: z.enum(["blocked", "allowed"]),
    })
    .strict()
    .refine((value) => value.memberRef || value.memberId, {
      message: "Provide memberId (the admin member ID) or memberRef",
    }),
});

const accessSync = z.object({
  data: z
    .object({
      force: z.boolean().optional(),
      dryRun: z.boolean().optional(),
    })
    .strict()
    .optional()
    .default({}),
});

export const AccessDto = {
  testUser,
  accessSync,
  updateSettings,
  createDevice,
  updateDevice,
  memberOverride,
};
