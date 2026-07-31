import { Schema, model } from "mongoose";
import { TIncomeCategory } from "./incomeCategory.interface";

const incomeCategorySchema = new Schema<TIncomeCategory>(
  {
    branchId: {
      type: Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    color: {
      type: String,
      default: "#10B981", // Emerald green theme for income
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  { timestamps: true },
);

incomeCategorySchema.index({ branchId: 1, isActive: 1 });

export const IncomeCategory = model<TIncomeCategory>(
  "IncomeCategory",
  incomeCategorySchema,
);
