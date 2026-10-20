import { Schema, model } from "mongoose";

import {
  DEFAULT_BRANCH_AUTO_DEACTIVATE_AFTER_UNPAID_MONTHS,
  getDefaultBranchAccessControl,
  getDefaultBranchSMSSettings,
  TBranch,
} from "./branch.interface";

const branchAccessControlSchema = new Schema(
  {
    enabled: { type: Boolean, default: false },
    graceDays: { type: Number, min: 0, max: 31, default: 5 },
    debounceMinutes: { type: Number, min: 0, max: 60, default: 5 },
    updatedAt: { type: Date, default: null },
    updatedBy: { type: Schema.Types.ObjectId, default: null },
  },
  { _id: false }
);

const branchSmsSettingsSchema = new Schema(
  {
    autoSendEnabled: {
      type: Boolean,
      default: false,
    },
    reminderDayOfMonth: {
      type: Number,
      min: 1,
      max: 31,
      default: 5,
    },
    template: {
      type: String,
      trim: true,
      default: getDefaultBranchSMSSettings().template,
    },
    templateBangla: {
      type: String,
      trim: true,
      default: getDefaultBranchSMSSettings().templateBangla,
    },
    occasionTemplate: {
      type: String,
      trim: true,
      default: getDefaultBranchSMSSettings().occasionTemplate,
    },
    occasionTemplateBangla: {
      type: String,
      trim: true,
      default: getDefaultBranchSMSSettings().occasionTemplateBangla,
    },
    promotionTemplate: {
      type: String,
      trim: true,
      default: getDefaultBranchSMSSettings().promotionTemplate,
    },
    promotionTemplateBangla: {
      type: String,
      trim: true,
      default: getDefaultBranchSMSSettings().promotionTemplateBangla,
    },
    defaultDeliveryMode: {
      type: String,
      enum: ["nonMasking", "masking"],
      default: getDefaultBranchSMSSettings().defaultDeliveryMode,
    },
    maskingSender: {
      type: String,
      trim: true,
      default: getDefaultBranchSMSSettings().maskingSender,
    },
    updatedAt: {
      type: Date,
      default: null,
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      default: null,
    },
    lastAutoReminderRunDate: {
      type: String,
      trim: true,
      default: null,
    },
  },
  {
    _id: false,
  }
);

const branchSchema = new Schema<TBranch>(
  {
    businessId: {
      type: Schema.Types.ObjectId,
      ref: "BusinessProfile",
      required: true,
      index: true,
    },
    branchName: {
      type: String,
      required: true,
      trim: true,
    },
    branchAddress: {
      type: String,
      trim: true,
    },
    monthlyFeeAmount: {
      type: Number,
      min: 0,
    },
    admissionFeeAmount: {
      type: Number,
      min: 0,
    },
    lockerFeeAmount: {
      type: Number,
      min: 0,
      default: 0,
    },
    autoDeactivateAfterUnpaidMonths: {
      type: Number,
      min: 1,
      default: DEFAULT_BRANCH_AUTO_DEACTIVATE_AFTER_UNPAID_MONTHS,
    },
    lastAutoDeactivationRunDate: {
      type: String,
      trim: true,
      default: null,
    },
    lastDueAccrualRunDate: {
      type: String,
      trim: true,
      default: null,
    },
    startingBalance: {
      type: Number,
      default: null,
    },
    startingBalanceSetAt: {
      type: Date,
      default: null,
    },
    smsSettings: {
      type: branchSmsSettingsSchema,
      default: () => getDefaultBranchSMSSettings(),
    },
    accessControl: {
      type: branchAccessControlSchema,
      default: () => getDefaultBranchAccessControl(),
    },
    logo: {
      type: String,
    },
    favicon: {
      type: String,
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

export const Branch = model<TBranch>("Branch", branchSchema);
