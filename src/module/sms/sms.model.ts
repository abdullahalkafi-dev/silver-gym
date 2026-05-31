import { model, Schema } from "mongoose";
import { TSmsHistory } from "./sms.interface";

const smsHistorySchema = new Schema<TSmsHistory>(
  {
    requestId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    branchId: {
      type: Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
      index: true,
    },
    memberId: {
      type: Schema.Types.ObjectId,
      ref: "Member",
      default: null,
      index: true,
    },
    memberName: {
      type: String,
      required: true,
      trim: true,
    },
    recipientPhone: {
      type: String,
      trim: true,
      default: null,
    },
    template: {
      type: String,
      required: true,
      trim: true,
    },
    templateCategory: {
      type: String,
      enum: ["due", "occasion", "promotion", "custom"],
      required: true,
    },
    renderedMessage: {
      type: String,
      required: true,
      trim: true,
    },
    audience: {
      type: String,
      enum: ["selected", "due"],
      required: true,
    },
    sendMode: {
      type: String,
      enum: ["manual", "auto"],
      required: true,
    },
    deliveryMode: {
      type: String,
      enum: ["nonMasking", "masking"],
      required: true,
    },
    messageType: {
      type: String,
      enum: ["text", "unicode"],
      required: true,
    },
    balanceBucket: {
      type: String,
      enum: ["nonMasking", "masking"],
      required: true,
    },
    status: {
      type: String,
      enum: ["simulated", "sent", "blocked", "failed"],
      required: true,
      index: true,
    },
    reason: {
      type: String,
      trim: true,
    },
    units: {
      type: Number,
      required: true,
      min: 0,
    },
    dueMonthLabel: {
      type: String,
      trim: true,
    },
    overdueMonths: {
      type: Number,
      min: 0,
    },
    monthlyDueAmount: {
      type: Number,
      min: 0,
    },
    totalDueAmount: {
      type: Number,
      min: 0,
    },
    requestedByUserId: {
      type: Schema.Types.ObjectId,
      default: null,
    },
    requestedByStaffId: {
      type: Schema.Types.ObjectId,
      default: null,
    },
    targetDate: {
      type: Date,
    },
    provider: {
      type: String,
      enum: ["wintel"],
      default: "wintel",
      required: true,
    },
    availableBalance: {
      type: Number,
      min: 0,
    },
    remainingBalance: {
      type: Number,
      min: 0,
    },
    providerReference: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true }
);

smsHistorySchema.index({ branchId: 1, createdAt: -1 });
smsHistorySchema.index({ branchId: 1, memberId: 1, createdAt: -1 });
smsHistorySchema.index({ requestId: 1, memberId: 1 });

export const SmsHistory = model<TSmsHistory>("SmsHistory", smsHistorySchema);
