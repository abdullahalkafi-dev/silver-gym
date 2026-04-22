import { Types } from "mongoose";

export enum ExpensePaymentMethod {
  CASH = "cash",
  BANK_TRANSFER = "bank_transfer",
  BKASH = "bkash",
  DUE = "due",
}

export interface TExpenseCategory {
  branchId: Types.ObjectId;
  title: string;
  description?: string;
  color?: string;
  isActive?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface TExpenseSubcategory {
  branchId: Types.ObjectId;
  categoryId: Types.ObjectId;
  title: string;
  isActive?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface TExpense {
  branchId: Types.ObjectId;
  subcategoryId: Types.ObjectId;
  subcategoryTitle?: string;
  categoryId?: Types.ObjectId;
  categoryTitle?: string;
  invoiceNo: string;
  description?: string;
  amount: number;
  paymentMethod: ExpensePaymentMethod;
  expenseDate: Date;
  isActive?: boolean;
  createdBy?: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}

export type TExpenseChangeType = "update" | "delete";

export interface TExpenseHistory {
  expenseId: Types.ObjectId;
  branchId: Types.ObjectId;
  snapshot: Record<string, unknown>;
  changedBy?: Types.ObjectId;
  changeType: TExpenseChangeType;
  changedAt?: Date;
}

export type TPartialExpenseCategory = Partial<TExpenseCategory>;
export type TPartialExpenseSubcategory = Partial<TExpenseSubcategory>;
export type TPartialExpense = Partial<TExpense>;
