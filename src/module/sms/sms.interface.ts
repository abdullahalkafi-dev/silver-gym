import { Types } from "mongoose";
import type { TSmsMessageKind } from "./sms.templates";

export type TSmsSendMode = "manual" | "auto";
export type TSmsHistoryStatus = "simulated" | "sent" | "blocked" | "failed" | "skipped";
export type TSmsDueDuration = "thisMonth" | "last2Months" | "last3Months" | "allDue";
export type TSmsMessageType = "text" | "unicode";
export type TSmsAudience = "due" | "selected" | "active" | "inactive" | "all";

export interface TSmsHistory {
  requestId: string;
  branchId: Types.ObjectId;
  memberId?: Types.ObjectId | null;
  memberName: string;
  recipientPhone?: string | null;
  templateKey: TSmsMessageKind;
  renderedMessage: string;
  audience: TSmsAudience;
  sendMode: TSmsSendMode;
  messageType: TSmsMessageType;
  status: TSmsHistoryStatus;
  reason?: string;
  units: number;
  /** Which sender style this message used (masking or non-masking). */
  senderType?: "masking" | "nonMasking";
  /** Set only on rows that were really sent; a unique index stops duplicate automatic SMS. */
  dedupeKey?: string;
  holidayId?: Types.ObjectId | null;
  retriedAt?: Date | null;
  dueMonthLabel?: string;
  overdueMonths?: number;
  totalDueAmount?: number;
  requestedByUserId?: Types.ObjectId | null;
  requestedByStaffId?: Types.ObjectId | null;
  provider: "fastsmsbd";
  providerReference?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface TSmsHoliday {
  branchId: Types.ObjectId;
  fromDate: Date;
  toDate: Date;
  reason: string;
  includeInactive: boolean;
  status: "draft" | "sent";
  sentAt?: Date | null;
  requestId?: string | null;
  sentCount?: number;
  failedCount?: number;
  createdByUserId?: Types.ObjectId | null;
  createdByStaffId?: Types.ObjectId | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export type TSmsBalanceSnapshot = {
  nonMaskingBalance: number;
  maskingBalance: number | null;
  fetchedAt: string;
  dryRun: boolean;
};

export type TSmsDueDurationCounts = {
  thisMonth: number;
  last2Months: number;
  last3Months: number;
  allDue: number;
};
