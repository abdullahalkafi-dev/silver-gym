import { Schema, model } from "mongoose";
import { LockerStatus, TLocker } from "./locker.interface";

const lockerSchema = new Schema<TLocker>(
  {
    branchId: {
      type: Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
      index: true,
    },
    lockerNumber: {
      type: Number,
      required: true,
      min: 1,
    },
    status: {
      type: String,
      enum: Object.values(LockerStatus),
      default: LockerStatus.AVAILABLE,
    },
    isCustomPrice: {
      type: Boolean,
      default: false,
    },
    customPrice: {
      type: Number,
      min: 0,
      default: 0,
    },
    assignedMemberId: {
      type: Schema.Types.ObjectId,
      ref: "Member",
      default: null,
    },
    assignedMemberName: {
      type: String,
      trim: true,
      default: null,
    },
    assignedMemberCode: {
      type: String,
      trim: true,
      default: null,
    },
    assignedAt: {
      type: Date,
      default: null,
    },
    nextBillingDate: {
      type: Date,
      default: null,
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

lockerSchema.index(
  { branchId: 1, lockerNumber: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } },
);
lockerSchema.index({ branchId: 1, isDeleted: 1 });
lockerSchema.index({ branchId: 1, status: 1 });

const Locker = model<TLocker>("Locker", lockerSchema);

export default Locker;
