import { z } from "zod";
import { computePaymentSettlement } from "./payment.balance";
import { PaymentMethod, PaymentStatus, PaymentType } from "./payment.interface";

const collectBillModeSchema = z.enum(["due_only", "monthly", "package"]);

const createPaymentDto = z.object({
  data: z
    .object({
      legacyId: z.string().trim().optional(),
      invoiceNo: z.string().trim().optional(),
      memberId: z.string().trim().optional(),
      memberLegacyId: z.string().trim().optional(),
      memberName: z.string().trim().optional(),
      packageId: z.string().trim().optional(),
      packageLegacyId: z.string().trim().optional(),
      packageName: z.string().trim().optional(),
      packageDuration: z.number().int().min(1).optional(),
      packageDurationType: z.string().trim().optional(),
      paymentType: z.enum(Object.values(PaymentType) as [string, ...string[]]),
      periodStart: z.coerce.date().optional(),
      periodEnd: z.coerce.date().optional(),
      paidMonths: z.number().int().min(1).optional(),
      year: z.number().int().optional(),
      subTotal: z.number().min(0, "Subtotal cannot be negative"),
      discount: z.number().min(0, "Discount cannot be negative").optional(),
      dueAmount: z.number().min(0, "Due amount cannot be negative").optional(),
      paidTotal: z.number().min(0, "Paid amount cannot be negative"),
      admissionFee: z.number().min(0, "Admission fee cannot be negative").optional(),
      paymentMethod: z.enum(Object.values(PaymentMethod) as [string, ...string[]]),
      paymentDate: z.coerce.date().optional(),
      nextPaymentDate: z.coerce.date().optional(),
      status: z.enum(Object.values(PaymentStatus) as [string, ...string[]]).optional(),
      source: z.string().trim().optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    })
    .strict()
    .superRefine((data, ctx) => {
      // PACKAGE payment type validations
      if (data.paymentType === PaymentType.PACKAGE) {
        if (!data.packageId && !data.packageLegacyId) {
          ctx.addIssue({
            code: "custom",
            path: ["packageId"],
            message: "Package ID or legacy ID is required for package payment type",
          });
        }
      }

      // MONTHLY payment type validations
      if (data.paymentType === PaymentType.MONTHLY) {
        if (!data.paidMonths) {
          ctx.addIssue({
            code: "custom",
            path: ["paidMonths"],
            message: "Paid months is required for monthly payment type",
          });
        }
      }

      // Period validation
      if (data.periodStart && data.periodEnd) {
        if (data.periodStart >= data.periodEnd) {
          ctx.addIssue({
            code: "custom",
            path: ["periodEnd"],
            message: "Period end must be after period start",
          });
        }
      }

      // Financial validation
      const settlement = computePaymentSettlement({
        subTotal: data.subTotal,
        paidTotal: data.paidTotal,
        discount: data.discount || 0,
      });

      if (data.dueAmount !== undefined) {
        if (Math.abs(settlement.dueAmount - data.dueAmount) > 0.01) {
          ctx.addIssue({
            code: "custom",
            path: ["dueAmount"],
            message: "Due amount must equal the outstanding amount after payment and discount",
          });
        }
      }

      if (settlement.overpaidAmount > 0.01) {
        ctx.addIssue({
          code: "custom",
          path: ["paidTotal"],
          message: "Paid amount cannot exceed the bill total after discount",
        });
      }
    }),
});

const updatePaymentDto = z.object({
  data: z
    .object({
      invoiceNo: z.string().trim().optional(),
      memberName: z.string().trim().optional(),
      packageName: z.string().trim().optional(),
      packageDuration: z.number().int().min(1).optional(),
      packageDurationType: z.string().trim().optional(),
      paymentType: z.enum(Object.values(PaymentType) as [string, ...string[]]).optional(),
      periodStart: z.coerce.date().optional(),
      periodEnd: z.coerce.date().optional(),
      paidMonths: z.number().int().min(1).optional(),
      year: z.number().int().optional(),
      subTotal: z.number().min(0, "Subtotal cannot be negative").optional(),
      discount: z.number().min(0, "Discount cannot be negative").optional(),
      dueAmount: z.number().min(0, "Due amount cannot be negative").optional(),
      paidTotal: z.number().min(0, "Paid amount cannot be negative").optional(),
      admissionFee: z.number().min(0, "Admission fee cannot be negative").optional(),
      paymentMethod: z.enum(Object.values(PaymentMethod) as [string, ...string[]]).optional(),
      paymentDate: z.coerce.date().optional(),
      nextPaymentDate: z.coerce.date().optional(),
      status: z.enum(Object.values(PaymentStatus) as [string, ...string[]]).optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    })
    .strict(),
});

const queryPaymentDto = z.object({
  query: z
    .object({
      searchTerm: z.string().trim().optional(),
      legacyId: z.string().trim().optional(),
      memberId: z.string().trim().optional(),
      memberLegacyId: z.string().trim().optional(),
      packageId: z.string().trim().optional(),
      paymentType: z.enum(Object.values(PaymentType) as [string, ...string[]]).optional(),
      paymentMethod: z.enum(Object.values(PaymentMethod) as [string, ...string[]]).optional(),
      status: z.enum(Object.values(PaymentStatus) as [string, ...string[]]).optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      minAmount: z.string().optional(),
      maxAmount: z.string().optional(),
      year: z.string().optional(),
      sort: z.string().trim().optional(),
      page: z.string().optional(),
      limit: z.string().optional(),
      fields: z.string().trim().optional(),
    })
    .strict(),
});

const collectBillContextDto = z.object({
  params: z
    .object({
      branchId: z.string().min(1, "branchId is required"),
      memberId: z.string().min(1, "memberId is required"),
    })
    .strict(),
});

const collectBillDueItemDto = z
  .object({
    ledgerItemId: z.string().trim().min(1, "ledgerItemId is required"),
    amount: z.number().positive("Selected due amount must be greater than 0"),
  })
  .strict();

const collectBillDto = z.object({
  data: z
    .object({
      memberId: z.string().trim().min(1, "memberId is required"),
      collectionMode: collectBillModeSchema,
      duePaymentAmount: z.number().min(0, "Due payment cannot be negative").optional(),
      selectedDueItems: z.array(collectBillDueItemDto).optional(),
      paidTotal: z.number().min(0, "Paid amount cannot be negative"),
      paymentMethod: z.enum(Object.values(PaymentMethod) as [string, ...string[]]),
      paymentDate: z.coerce.date().optional(),
      discount: z.number().min(0, "Discount cannot be negative").optional(),
      startDate: z.coerce.date().optional(),
      paidMonths: z.number().int().min(1, "Paid months must be at least 1").optional(),
      packageId: z.string().trim().optional(),
      note: z.string().trim().max(500).optional(),
      useCustomMonthlyFee: z.boolean().optional(),
      customMonthlyFeeAmount: z.number().positive("Custom monthly fee must be greater than 0").optional(),
    })
    .strict()
    .superRefine((data, ctx) => {
      if (data.selectedDueItems?.length) {
        const seenLedgerItemIds = new Set<string>();

        data.selectedDueItems.forEach((item, index) => {
          if (seenLedgerItemIds.has(item.ledgerItemId)) {
            ctx.addIssue({
              code: "custom",
              path: ["selectedDueItems", index, "ledgerItemId"],
              message: "Duplicate due items are not allowed",
            });
            return;
          }

          seenLedgerItemIds.add(item.ledgerItemId);
        });
      }

      if (data.selectedDueItems?.length && data.duePaymentAmount !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["duePaymentAmount"],
          message: "Use either duePaymentAmount or selectedDueItems, not both",
        });
      }

      if (data.collectionMode === "monthly" && !data.paidMonths) {
        ctx.addIssue({
          code: "custom",
          path: ["paidMonths"],
          message: "paidMonths is required for monthly collection",
        });
      }

      if (data.collectionMode === "package" && !data.packageId) {
        ctx.addIssue({
          code: "custom",
          path: ["packageId"],
          message: "packageId is required for package collection",
        });
      }
    }),
});

export const PaymentDto = {
  create: createPaymentDto,
  update: updatePaymentDto,
  query: queryPaymentDto,
  collectBillContext: collectBillContextDto,
  collectBill: collectBillDto,
};
