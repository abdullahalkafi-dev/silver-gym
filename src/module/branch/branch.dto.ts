import { z } from "zod";

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

const updateBranchImportSettingsDto = z.object({
  data: z
    .object({
      allowDuplicatePhoneOnImport: z.boolean(),
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
  updateImportSettings: updateBranchImportSettingsDto,
  setStartingBalance: setStartingBalanceDto,
};
