import { Schema, model } from "mongoose";

export type TInvoiceCounterType = "PAYMENT" | "EXPENSE" | "LOCKER" | "INCOME";

interface TInvoiceCounter {
  type: TInvoiceCounterType;
  lastSequence: number;
}

const invoiceCounterSchema = new Schema<TInvoiceCounter>(
  {
    type: {
      type: String,
      required: true,
      enum: ["PAYMENT", "EXPENSE", "LOCKER", "INCOME"],
    },
    lastSequence: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { timestamps: true },
);

invoiceCounterSchema.index({ type: 1 }, { unique: true });

export const InvoiceCounter = model<TInvoiceCounter>(
  "InvoiceCounter",
  invoiceCounterSchema,
);
