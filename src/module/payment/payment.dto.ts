import { z } from "zod";
import { PaymentMethod, PaymentStatus, PaymentType } from "./payment.interface";

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
      if (data.dueAmount !== undefined) {
        const calculatedDue = data.subTotal - data.paidTotal - (data.discount || 0);
        if (Math.abs(calculatedDue - data.dueAmount) > 0.01) {
          ctx.addIssue({
            code: "custom",
            path: ["dueAmount"],
            message: "Due amount must equal subTotal - paidTotal - discount",
          });
        }
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

export const PaymentDto = {
  create: createPaymentDto,
  update: updatePaymentDto,
  query: queryPaymentDto,
};
