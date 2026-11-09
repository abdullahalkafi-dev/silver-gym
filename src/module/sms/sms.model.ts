import { model, Schema } from "mongoose";
import { TSmsHistory, TSmsHoliday } from "./sms.interface";

const smsHistorySchema = new Schema<TSmsHistory>(
  {
    requestId: { type: String, required: true, trim: true, index: true },
    branchId: { type: Schema.Types.ObjectId, ref: "Branch", required: true, index: true },
    memberId: { type: Schema.Types.ObjectId, ref: "Member", default: null, index: true },
    memberName: { type: String, required: true, trim: true },
    recipientPhone: { type: String, trim: true, default: null },
    templateKey: {
      type: String,
      enum: [
        "dueReminder",
        "holiday",
        "birthday",
        "paymentConfirmation",
        "membershipExpired",
        "welcome",
        "custom",
      ],
      default: "custom",
      required: true,
    },
    renderedMessage: { type: String, required: true, trim: true },
    audience: {
      type: String,
      enum: ["due", "selected", "active", "inactive", "all"],
      required: true,
    },
    sendMode: { type: String, enum: ["manual", "auto"], required: true },
    messageType: { type: String, enum: ["text", "unicode"], required: true },
    status: {
      type: String,
      enum: ["simulated", "sent", "blocked", "failed", "skipped"],
      required: true,
    },
    reason: { type: String, trim: true },
    units: { type: Number, required: true, min: 0 },
    senderType: { type: String, enum: ["masking", "nonMasking"] },
    dedupeKey: { type: String, trim: true },
    holidayId: { type: Schema.Types.ObjectId, ref: "SmsHoliday", default: null },
    retriedAt: { type: Date, default: null },
    dueMonthLabel: { type: String, trim: true },
    overdueMonths: { type: Number, min: 0 },
    totalDueAmount: { type: Number, min: 0 },
    requestedByUserId: { type: Schema.Types.ObjectId, default: null },
    requestedByStaffId: { type: Schema.Types.ObjectId, default: null },
    provider: { type: String, enum: ["fastsmsbd"], default: "fastsmsbd", required: true },
    providerReference: { type: String, trim: true },
  },
  { timestamps: true },
);

smsHistorySchema.index({ branchId: 1, createdAt: -1 });
smsHistorySchema.index({ branchId: 1, memberId: 1, createdAt: -1 });
smsHistorySchema.index({ requestId: 1, memberId: 1 });
// One really-sent automatic SMS per key (e.g. "welcome:<memberId>"): retries and
// restarts can never send the same automatic message twice.
smsHistorySchema.index(
  { branchId: 1, dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: "string" } } },
);

export const SmsHistory = model<TSmsHistory>("SmsHistory", smsHistorySchema);

const smsHolidaySchema = new Schema<TSmsHoliday>(
  {
    branchId: { type: Schema.Types.ObjectId, ref: "Branch", required: true, index: true },
    fromDate: { type: Date, required: true },
    toDate: { type: Date, required: true },
    reason: { type: String, required: true, trim: true },
    includeInactive: { type: Boolean, default: false },
    status: { type: String, enum: ["draft", "sent"], default: "draft" },
    sentAt: { type: Date, default: null },
    requestId: { type: String, default: null },
    sentCount: { type: Number, default: 0 },
    failedCount: { type: Number, default: 0 },
    createdByUserId: { type: Schema.Types.ObjectId, default: null },
    createdByStaffId: { type: Schema.Types.ObjectId, default: null },
  },
  { timestamps: true },
);

smsHolidaySchema.index({ branchId: 1, fromDate: -1 });

export const SmsHoliday = model<TSmsHoliday>("SmsHoliday", smsHolidaySchema);
