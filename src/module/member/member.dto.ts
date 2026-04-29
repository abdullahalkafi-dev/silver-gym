import { z } from "zod";
import { PaymentMethod, PaymentStatus } from "module/payment/payment.interface";

const TRAINING_GOALS = [
  "Yoga",
  "Cardio Endurance",
  "Bodybuilding",
  "Muscle Gain",
  "Flexibility & Mobility",
  "General Fitness",
  "Strength Training",
] as const;

const emergencyContactSchema = z
  .object({
    relationship: z.string().trim().min(1, "Relationship is required"),
    contactNumber: z.string().trim().min(1, "Emergency contact number is required"),
  })
  .strict();

const createPaymentSchema = z
  .object({
    paymentMethod: z.enum(Object.values(PaymentMethod) as [string, ...string[]]),
    paidTotal: z.number().min(0, "Paid amount cannot be negative"),
    discount: z.number().min(0, "Discount cannot be negative").optional(),
    admissionFee: z.number().min(0, "Admission fee cannot be negative").optional(),
    paymentDate: z.coerce.date().optional(),
    status: z
      .enum(Object.values(PaymentStatus) as [string, ...string[]])
      .optional(),
  })
  .strict();

const monthlyFeeInputSchema = z.number().nonnegative();

const createMemberDto = z.object({
  data: z
    .object({
      memberId: z.string().trim().optional(),
      barcode: z.string().trim().optional(),
      fullName: z.string().trim().min(1, "Full name is required"),
      contact: z.string().trim().optional(),
      email: z.email("Invalid email").trim().toLowerCase().optional(),
      dateOfBirth: z.coerce.date().optional(),
      country: z.string().trim().optional(),
      nid: z.string().trim().optional(),
      gender: z.string().trim().optional(),
      bloodGroup: z.string().trim().optional(),
      height: z.number().nonnegative().optional(),
      heightUnit: z.enum(["cm", "in", "ft"]).optional(),
      weight: z.number().nonnegative().optional(),
      weightUnit: z.enum(["kg", "lb"]).optional(),
      address: z.string().trim().optional(),
      emergencyContact: emergencyContactSchema.optional(),
      trainingGoals: z.array(z.enum(TRAINING_GOALS)).optional(),
      currentPackageId: z.string().trim().optional(),
      membershipStartDate: z.coerce.date().optional(),
      isCustomMonthlyFee: z.boolean().optional(),
      customMonthlyFeeAmount: monthlyFeeInputSchema.optional(),
      paidMonths: z.number().int().min(1).optional(),
      payment: createPaymentSchema,
      metadata: z.record(z.string(), z.unknown()).optional(),
    })
    .strict()
    .superRefine((data, ctx) => {
      const hasPackage = Boolean(data.currentPackageId);
      const hasPaidMonths = typeof data.paidMonths === "number" && data.paidMonths > 0;

      // Must provide either a package or paidMonths (monthly billing trigger)
      if (!hasPackage && !hasPaidMonths) {
        ctx.addIssue({
          code: "custom",
          path: ["currentPackageId"],
          message: "Provide either currentPackageId or paidMonths (for monthly billing)",
        });
      }

      // isCustomMonthlyFee and currentPackageId CAN coexist — it stores the member's
      // personal monthly rate that applies after the package ends.

      // If isCustomMonthlyFee is true, customMonthlyFeeAmount is required
      if (data.isCustomMonthlyFee === true && data.customMonthlyFeeAmount == null) {
        ctx.addIssue({
          code: "custom",
          path: ["customMonthlyFeeAmount"],
          message: "customMonthlyFeeAmount is required when isCustomMonthlyFee is true",
        });
      }

      // customMonthlyFeeAmount only makes sense when isCustomMonthlyFee is true
      if (data.isCustomMonthlyFee !== true && data.customMonthlyFeeAmount != null) {
        ctx.addIssue({
          code: "custom",
          path: ["customMonthlyFeeAmount"],
          message: "customMonthlyFeeAmount can only be provided when isCustomMonthlyFee is true",
        });
      }
    }),
});

const updateMemberDto = z.object({
  data: z
    .object({
      isActive: z.boolean().optional(),
      fullName: z.string().trim().min(1).optional(),
      contact: z.string().trim().optional(),
      email: z.email("Invalid email").trim().toLowerCase().optional(),
      dateOfBirth: z.coerce.date().optional(),
      country: z.string().trim().optional(),
      nid: z.string().trim().optional(),
      gender: z.string().trim().optional(),
      bloodGroup: z.string().trim().optional(),
      height: z.number().nonnegative().optional(),
      heightUnit: z.enum(["cm", "in", "ft"]).optional(),
      weight: z.number().nonnegative().optional(),
      weightUnit: z.enum(["kg", "lb"]).optional(),
      address: z.string().trim().optional(),
      emergencyContact: emergencyContactSchema.optional(),
      trainingGoals: z.array(z.enum(TRAINING_GOALS)).optional(),
      currentPackageId: z.string().trim().optional(),
      membershipStartDate: z.coerce.date().optional(),
      membershipEndDate: z.coerce.date().optional(),
      nextPaymentDate: z.coerce.date().optional(),
      isCustomMonthlyFee: z.boolean().optional(),
      customMonthlyFeeAmount: monthlyFeeInputSchema.optional(),
      paidMonths: z.number().int().min(0).optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    })
    .strict()
    .superRefine((data, ctx) => {
      // isCustomMonthlyFee and currentPackageId CAN coexist.

      // If isCustomMonthlyFee is explicitly set to false, customMonthlyFeeAmount must not be present
      if (data.isCustomMonthlyFee === false && data.customMonthlyFeeAmount != null) {
        ctx.addIssue({
          code: "custom",
          path: ["customMonthlyFeeAmount"],
          message: "customMonthlyFeeAmount can only be provided when isCustomMonthlyFee is true",
        });
      }

      // If customMonthlyFeeAmount is provided, isCustomMonthlyFee must be true
      if (data.customMonthlyFeeAmount != null && data.isCustomMonthlyFee !== true) {
        ctx.addIssue({
          code: "custom",
          path: ["customMonthlyFeeAmount"],
          message: "customMonthlyFeeAmount requires isCustomMonthlyFee to be true",
        });
      }
    }),
});

const startGoogleSheetImportDto = z.object({
  data: z
    .object({
      spreadsheetId: z.string().trim().min(1, "spreadsheetId is required"),
      range: z.string().trim().min(1).optional(),
    })
    .strict(),
});

const retryImportDto = z.object({
  params: z
    .object({
      branchId: z.string().min(1, "branchId is required"),
      batchId: z.string().min(1, "batchId is required"),
    })
    .strict(),
});

const listImportBatchesDto = z.object({
  params: z
    .object({
      branchId: z.string().min(1, "branchId is required"),
    })
    .strict(),
  query: z
    .object({
      page: z.string().optional(),
      limit: z.string().optional(),
      status: z
        .enum([
          "pending",
          "processing",
          "completed",
          "partial_failed",
          "failed",
          "cancelled",
        ])
        .optional(),
    })
    .strict(),
});

const listMembersDto = z.object({
  params: z
    .object({
      branchId: z.string().min(1, "branchId is required"),
    })
    .strict(),
  query: z
    .object({
      searchTerm: z.string().trim().optional(),
      isActive: z.enum(["true", "false"]).optional(),
      includeInactive: z.enum(["true"]).optional(),
      paymentStatus: z.enum(["due", "complete"]).optional(),
      page: z.string().optional(),
      limit: z.string().optional(),
      sort: z.string().optional(),
      sortBy: z.string().optional(),
      sortOrder: z.enum(["asc", "desc"]).optional(),
      fields: z.string().optional(),
    })
    .strict(),
});

const importMetricsDto = z.object({
  params: z
    .object({
      branchId: z.string().min(1, "branchId is required"),
    })
    .strict(),
  query: z
    .object({
      days: z.string().optional(),
    })
    .strict(),
});

const dashboardSummaryDto = z.object({
  params: z
    .object({
      branchId: z.string().min(1, "branchId is required"),
    })
    .strict(),
  query: z
    .object({
      days: z.string().optional(),
    })
    .strict(),
});

const startCSVImportDto = z.object({
  params: z
    .object({
      branchId: z.string().min(1, "branchId is required"),
    })
    .strict(),
});

export const MemberDto = {
  create: createMemberDto,
  update: updateMemberDto,
  startGoogleSheetImport: startGoogleSheetImportDto,
  startCSVImport: startCSVImportDto,
  retryImport: retryImportDto,
  listImportBatches: listImportBatchesDto,
  listMembers: listMembersDto,
  importMetrics: importMetricsDto,
  dashboardSummary: dashboardSummaryDto,
};
