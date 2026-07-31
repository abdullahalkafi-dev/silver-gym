import { Types } from "mongoose";

export type TSmsAudience = "selected" | "due";
export type TSmsSendMode = "manual" | "auto";
export type TSmsHistoryStatus = "simulated" | "sent" | "blocked" | "failed";
export type TSmsDeliveryMode = "nonMasking" | "masking";
export type TSmsTemplateCategory = "due" | "occasion" | "promotion" | "custom";
export type TSmsDueDuration = "thisMonth" | "last2Months" | "last3Months" | "allDue";
export type TSmsMessageType = "text" | "unicode";
export type TSmsMessageTypeSummary = TSmsMessageType | "mixed";
export type TSmsBalanceBucket = "nonMasking" | "masking";

export interface TSmsHistory {
  requestId: string;
  branchId: Types.ObjectId;
  memberId?: Types.ObjectId | null;
  memberName: string;
  recipientPhone?: string | null;
  template: string;
  templateCategory: TSmsTemplateCategory;
  renderedMessage: string;
  audience: TSmsAudience;
  sendMode: TSmsSendMode;
  deliveryMode: TSmsDeliveryMode;
  messageType: TSmsMessageType;
  balanceBucket: TSmsBalanceBucket;
  status: TSmsHistoryStatus;
  reason?: string;
  units: number;
  dueMonthLabel?: string;
  overdueMonths?: number;
  monthlyDueAmount?: number;
  totalDueAmount?: number;
  requestedByUserId?: Types.ObjectId | null;
  requestedByStaffId?: Types.ObjectId | null;
  targetDate?: Date;
  provider: "fastsmsbd";
  availableBalance?: number | null;
  remainingBalance?: number | null;
  providerReference?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export type TSmsBalanceSnapshot = {
  nonMaskingBalance: number;
  maskingBalance: number | null;
  fetchedAt: string;
  dryRun: boolean;
};

export type TSmsRecipientPreview = {
  memberId: string;
  memberName: string;
  memberIdentifier?: string;
  recipientPhone: string | null;
  dueMonthLabel: string;
  overdueMonths: number;
  monthlyDueAmount: number;
  totalDueAmount: number;
  renderedMessage: string;
  messageType: TSmsMessageType;
  units: number;
  status: "ready" | "blocked";
  reason?: string;
};

export type TSmsPreviewSummary = {
  totalRecipients: number;
  readyRecipients: number;
  blockedRecipients: number;
  requiredUnits: number;
  availableBalance: number;
  remainingBalance: number;
  canSend: boolean;
  insufficientBalance: boolean;
  deliveryMode: TSmsDeliveryMode;
  balanceBucket: TSmsBalanceBucket;
  messageType: TSmsMessageTypeSummary;
  textRecipients: number;
  unicodeRecipients: number;
  messagesOverSingleSmsLimit: number;
  singleSmsCharacterLimit: number;
};

export type TSmsDueDurationCounts = {
  thisMonth: number;
  last2Months: number;
  last3Months: number;
  allDue: number;
};
