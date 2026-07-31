import { z } from "zod";

const ENGLISH_SMS_TEXT_PATTERN = /^[\x20-\x7E\r\n]*$/;

const englishSmsField = (label: string, max: number) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .max(max, `${label} must be ${max} characters or fewer`)
    .refine(
      (value) => ENGLISH_SMS_TEXT_PATTERN.test(value),
      `${label} must use English characters only`,
    );

const smsField = (label: string, max: number) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .max(max, `${label} must be ${max} characters or fewer`);

const updateBranchSMSSettingsSchema = z.object({
  data: z
    .object({
      autoSendEnabled: z.boolean().optional(),
      reminderDayOfMonth: z
        .number()
        .int()
        .min(1, "Reminder day must be at least 1")
        .max(31, "Reminder day cannot exceed 31")
        .optional(),
      template: englishSmsField("SMS template", 160).optional(),
      templateBangla: smsField("Bangla SMS template", 300).optional(),
      occasionTemplate: englishSmsField("Occasion template", 480).optional(),
      occasionTemplateBangla: smsField("Bangla occasion template", 300).optional(),
      promotionTemplate: englishSmsField("Promotion template", 480).optional(),
      promotionTemplateBangla: smsField("Bangla promotion template", 300).optional(),
      defaultDeliveryMode: z.literal("masking").optional(),
      maskingSender: z
        .union([
          z
            .string()
            .trim()
            .min(1)
            .max(32, "Masking sender must be 32 characters or fewer")
            .refine(
              (value) => ENGLISH_SMS_TEXT_PATTERN.test(value),
              "Masking sender must use English characters only",
            ),
          z.null(),
        ])
        .optional(),
    })
    .strict()
    .superRefine((data, ctx) => {
      if (Object.keys(data).length > 0) {
        return;
      }

      ctx.addIssue({
        code: "custom",
        path: ["data"],
        message: "At least one SMS settings field is required",
      });
    }),
});

const createBranchDto = z.object({
  data: z
    .object({
      branchName: z
        .string()
        .min(1, "Branch name is required")
        .min(2, "Branch name must be at least 2 characters")
        .trim(),
      branchAddress: z.string().trim().optional(),
      monthlyFeeAmount: z
        .number()
        .min(0, "Monthly fee amount cannot be negative")
        .optional(),
      admissionFeeAmount: z
        .number()
        .min(0, "Admission fee amount cannot be negative")
        .optional(),
    })
    .strict(),
});

const updateBranchDto = z.object({
  data: z
    .object({
      branchName: z
        .string()
        .min(2, "Branch name must be at least 2 characters")
        .trim()
        .optional(),
      branchAddress: z.string().trim().optional(),
      monthlyFeeAmount: z
        .number()
        .min(0, "Monthly fee amount cannot be negative")
        .optional(),
      admissionFeeAmount: z
        .number()
        .min(0, "Admission fee amount cannot be negative")
        .optional(),
    })
    .strict(),
});

const updateBranchMonthlyFeeDto = z.object({
  data: z
    .object({
      monthlyFeeAmount: z
        .number()
        .min(0, "Monthly fee amount cannot be negative"),
    })
    .strict(),
});

const updateBranchAdmissionFeeDto = z.object({
  data: z
    .object({
      admissionFeeAmount: z
        .number()
        .min(0, "Admission fee amount cannot be negative"),
    })
    .strict(),
});

const updateBranchAutoDeactivationSettingsDto = z.object({
  data: z
    .object({
      autoDeactivateAfterUnpaidMonths: z
        .number()
        .int("Auto-deactivation months must be a whole number")
        .min(1, "Auto-deactivation months must be at least 1"),
    })
    .strict(),
});

const setStartingBalanceDto = z.object({
  data: z
    .object({
      startingBalance: z
        .number()
        .finite("Starting balance must be a valid number"),
    })
    .strict(),
});

export const BranchDto = {
  create: createBranchDto,
  update: updateBranchDto,
  updateMonthlyFee: updateBranchMonthlyFeeDto,
  updateAdmissionFee: updateBranchAdmissionFeeDto,
  updateAutoDeactivationSettings: updateBranchAutoDeactivationSettingsDto,
  updateSMSSettings: updateBranchSMSSettingsSchema,
  setStartingBalance: setStartingBalanceDto,
};
