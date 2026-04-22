import { model, Schema } from "mongoose";
import {
  ExpensePaymentMethod,
  TExpense,
  TExpenseCategory,
  TExpenseHistory,
  TExpenseSubcategory,
} from "./expense.interface";

// ─── Expense Category ────────────────────────────────────────────────────────

const expenseCategorySchema = new Schema<TExpenseCategory>(
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
      default: "#7C3AED",
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  { timestamps: true },
);

expenseCategorySchema.index({ branchId: 1, isActive: 1 });

export const ExpenseCategory = model<TExpenseCategory>(
  "ExpenseCategory",
  expenseCategorySchema,
);

// ─── Expense Subcategory ─────────────────────────────────────────────────────

const expenseSubcategorySchema = new Schema<TExpenseSubcategory>(
  {
    branchId: {
      type: Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
      index: true,
    },
    categoryId: {
      type: Schema.Types.ObjectId,
      ref: "ExpenseCategory",
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  { timestamps: true },
);

expenseSubcategorySchema.index({ branchId: 1, categoryId: 1, isActive: 1 });

export const ExpenseSubcategory = model<TExpenseSubcategory>(
  "ExpenseSubcategory",
  expenseSubcategorySchema,
);

// ─── Expense ─────────────────────────────────────────────────────────────────

const expenseSchema = new Schema<TExpense>(
  {
    branchId: {
      type: Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
      index: true,
    },
    subcategoryId: {
      type: Schema.Types.ObjectId,
      ref: "ExpenseSubcategory",
      required: true,
    },
    subcategoryTitle: {
      type: String,
      trim: true,
    },
    categoryId: {
      type: Schema.Types.ObjectId,
      ref: "ExpenseCategory",
    },
    categoryTitle: {
      type: String,
      trim: true,
    },
    invoiceNo: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    paymentMethod: {
      type: String,
      enum: Object.values(ExpensePaymentMethod),
      required: true,
    },
    expenseDate: {
      type: Date,
      required: true,
      default: Date.now,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
    },
  },
  { timestamps: true },
);

expenseSchema.index({ branchId: 1, expenseDate: -1, isActive: 1 });
expenseSchema.index({ branchId: 1, subcategoryId: 1, isActive: 1 });

export const Expense = model<TExpense>("Expense", expenseSchema);

// ─── Expense History ──────────────────────────────────────────────────────────

const expenseHistorySchema = new Schema<TExpenseHistory>(
  {
    expenseId: {
      type: Schema.Types.ObjectId,
      ref: "Expense",
      required: true,
      index: true,
    },
    branchId: {
      type: Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
      index: true,
    },
    snapshot: {
      type: Schema.Types.Mixed,
      required: true,
    },
    changedBy: {
      type: Schema.Types.ObjectId,
    },
    changeType: {
      type: String,
      enum: ["update", "delete"],
      required: true,
    },
    changedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: false },
);

expenseHistorySchema.index({ expenseId: 1, changedAt: -1 });

export const ExpenseHistory = model<TExpenseHistory>(
  "ExpenseHistory",
  expenseHistorySchema,
);
