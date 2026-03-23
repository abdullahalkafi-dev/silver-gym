import { z } from "zod";
import { BusinessType } from "./businessProfile.interface";

const businessTypeValues = Object.values(BusinessType) as [string, ...string[]];

const createBusinessProfileDto = z.object({
  data: z
    .object({
      businessName: z
        .string()
        .min(1, "Business name is required")
        .min(2, "Business name must be at least 2 characters")
        .trim(),
      businessType: z.enum(businessTypeValues),
      registrationNumber: z.string().trim().optional(),
      businessAddress: z.string().trim().optional(),
      city: z.string().trim().optional(),
      country: z.string().trim().optional(),
      zip: z.string().trim().optional(),
      businessPhoneNumber: z.string().trim().optional(),
      businessEmail: z
        .email("Invalid email address")
        .toLowerCase()
        .trim()
        .optional(),
    })
    .strict(),
});

const updateBusinessProfileDto = z.object({
  data: z
    .object({
      businessName: z
        .string()
        .min(2, "Business name must be at least 2 characters")
        .trim()
        .optional(),
      businessType: z.enum(businessTypeValues).optional(),
      registrationNumber: z.string().trim().optional(),
      businessAddress: z.string().trim().optional(),
      city: z.string().trim().optional(),
      country: z.string().trim().optional(),
      zip: z.string().trim().optional(),
      businessPhoneNumber: z.string().trim().optional(),
      businessEmail: z
        .email("Invalid email address")
        .toLowerCase()
        .trim()
        .optional(),
    })
    .strict(),
});

export const BusinessProfileDto = {
  create: createBusinessProfileDto,
  update: updateBusinessProfileDto,
};
