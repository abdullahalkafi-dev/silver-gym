import { z } from "zod";
import { LockerStatus } from "./locker.interface";
import { PaymentMethod } from "../payment/payment.interface";

const createLockers = z.object({
  data: z.object({
    count: z
      .number()
      .int()
      .min(1, "Count must be at least 1")
      .max(500, "Cannot create more than 500 lockers at once"),
  }),
});

const updateLocker = z.object({
  data: z.object({
    status: z.enum(Object.values(LockerStatus) as [string, ...string[]]).optional(),
    lockerNumber: z.number().int().min(1).optional(),
  }),
});

const setBranchPrice = z.object({
  data: z.object({
    price: z.number().min(0, "Price must be non-negative"),
  }),
});

const setCustomPrice = z.object({
  data: z.object({
    price: z.number().min(0, "Price must be non-negative"),
  }),
});

const assignMember = z.object({
  data: z.object({
    memberId: z.string().min(1, "Member ID is required"),
    months: z.number().int().min(1).max(24).default(1),
    paymentAmount: z.number().min(0, "Payment amount must be non-negative"),
    paymentMethod: z
      .enum(Object.values(PaymentMethod) as [string, ...string[]])
      .default("cash"),
    discount: z.number().min(0).default(0),
    note: z.string().optional(),
  }),
});

const collectPayment = z.object({
  data: z.object({
    months: z.number().int().min(1).max(24).default(1),
    paymentAmount: z.number().min(0, "Payment amount must be non-negative").optional(),
    paymentMethod: z
      .enum(Object.values(PaymentMethod) as [string, ...string[]])
      .default("cash"),
    discount: z.number().min(0).default(0),
    note: z.string().optional(),
  }),
});

export const LockerDto = {
  createLockers,
  updateLocker,
  setBranchPrice,
  setCustomPrice,
  assignMember,
  collectPayment,
};
