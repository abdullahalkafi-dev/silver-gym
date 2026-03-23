import { z } from "zod";

const createBranchDto = z.object({
  body: z
    .object({
      branchName: z
        .string()
        .min(1, "Branch name is required")
        .min(2, "Branch name must be at least 2 characters")
        .trim(),
      branchAddress: z.string().trim().optional(),
    })
    .strict(),
});

const updateBranchDto = z.object({
  body: z
    .object({
      branchName: z
        .string()
        .min(2, "Branch name must be at least 2 characters")
        .trim()
        .optional(),
      branchAddress: z.string().trim().optional(),
    })
    .strict(),
});

export const BranchDto = {
  create: createBranchDto,
  update: updateBranchDto,
};
