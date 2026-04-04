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

export const BranchDto = {
  create: createBranchDto,
  update: updateBranchDto,
  updateMonthlyFee: updateBranchMonthlyFeeDto,
};
