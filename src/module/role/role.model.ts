import { Schema, model } from "mongoose";

import { TRole } from "./role.interface";

const roleSchema = new Schema<TRole>(
  {
    branchId: {
      type: Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
      index: true,
    },
    roleName: {
      type: String,
      required: true,
      trim: true,
    },
    canViewMembers: { type: Boolean, default: false },
    canAddMember: { type: Boolean, default: false },
    canEditMember: { type: Boolean, default: false },
    canDeleteMember: { type: Boolean, default: false },
    canViewPackages: { type: Boolean, default: false },
    canAddPackage: { type: Boolean, default: false },
    canEditPackage: { type: Boolean, default: false },
    canDeletePackage: { type: Boolean, default: false },
    canViewPayments: { type: Boolean, default: false },
    canAddPayment: { type: Boolean, default: false },
    canEditPayment: { type: Boolean, default: false },
    canDeletePayment: { type: Boolean, default: false },
    canRefundPayment: { type: Boolean, default: false },
    canViewBilling: { type: Boolean, default: false },
    canAddBilling: { type: Boolean, default: false },
    canEditBilling: { type: Boolean, default: false },
    canDeleteBilling: { type: Boolean, default: false },
    canAddMonthlyFee: { type: Boolean, default: false },
    canEditMonthlyFee: { type: Boolean, default: false },
    canAddAdmissionFee: { type: Boolean, default: false },
    canEditAdmissionFee: { type: Boolean, default: false },
    canViewAnalytics: { type: Boolean, default: false },
    canExportAnalytics: { type: Boolean, default: false },
    canViewSMS: { type: Boolean, default: false },
    canSendSMS: { type: Boolean, default: false },
    canViewEmail: { type: Boolean, default: false },
    canSendEmail: { type: Boolean, default: false },
    canViewExpenseCategory: { type: Boolean, default: false },
    canManageExpenseCategory: { type: Boolean, default: false },
    canViewExpense: { type: Boolean, default: false },
    canAddExpense: { type: Boolean, default: false },
  },
  {
    timestamps: true,
  }
);

export const Role = model<TRole>("Role", roleSchema);
