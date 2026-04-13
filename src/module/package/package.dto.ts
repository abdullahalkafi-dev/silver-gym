import { z } from "zod";
import { PackageDurationType } from "./package.interface";

const createPackageDto = z.object({
  body: z
    .object({
      legacyId: z.string().trim().optional(),
      title: z.string().trim().min(1, "Package title is required"),
      duration: z.number().int().min(1, "Duration must be at least 1"),
      durationType: z.enum(Object.values(PackageDurationType) as [string, ...string[]]),
      description: z.string().trim().optional(),
      color: z.string().trim().optional(),
      amount: z.number().min(0, "Amount cannot be negative"),
      includeAdmissionFee: z.boolean().optional(),
      admissionFeeAmount: z.number().min(0, "Admission fee cannot be negative").optional(),
      isActive: z.boolean().optional(),
      source: z.string().trim().optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    })
    .strict(),
});

const updatePackageDto = z.object({
  body: z
    .object({
      title: z.string().trim().min(1, "Package title is required").optional(),
      duration: z.number().int().min(1, "Duration must be at least 1").optional(),
      durationType: z.enum(Object.values(PackageDurationType) as [string, ...string[]]).optional(),
      description: z.string().trim().optional(),
      color: z.string().trim().optional(),
      amount: z.number().min(0, "Amount cannot be negative").optional(),
      includeAdmissionFee: z.boolean().optional(),
      admissionFeeAmount: z.number().min(0, "Admission fee cannot be negative").optional(),
      isActive: z.boolean().optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    })
    .strict(),
});

const queryPackageDto = z.object({
  query: z
    .object({
      searchTerm: z.string().trim().optional(),
      legacyId: z.string().trim().optional(),
      durationType: z.enum(Object.values(PackageDurationType) as [string, ...string[]]).optional(),
      isActive: z.enum(["true", "false"]).optional(),
      minAmount: z.string().optional(),
      maxAmount: z.string().optional(),
      includeAdmissionFee: z.enum(["true", "false"]).optional(),
      sort: z.string().trim().optional(),
      page: z.string().optional(),
      limit: z.string().optional(),
      fields: z.string().trim().optional(),
    })
    .strict(),
});

export const PackageDto = {
  create: createPackageDto,
  update: updatePackageDto,
  query: queryPackageDto,
};
