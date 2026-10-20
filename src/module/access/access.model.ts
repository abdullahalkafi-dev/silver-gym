import { Schema, model } from "mongoose";

import { TAccessDevice, TAttendanceLog } from "./access.interface";

const accessDeviceSchema = new Schema<TAccessDevice>(
  {
    branchId: {
      type: Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    deviceModel: { type: String, trim: true },
    serialNumber: { type: String, trim: true },
    host: { type: String, required: true, trim: true },
    port: { type: Number, required: true, min: 1, max: 65535 },
    isActive: { type: Boolean, default: true },
    lastSeenAt: { type: Date, default: null },
    lastPullAt: { type: Date, default: null },
    lastLogCount: { type: Number, default: null },
    lastError: { type: String, default: null },
    writeEnabled: { type: Boolean, default: false },
    blockGroup: { type: Number, min: 0, max: 255, default: null },
    allowGroup: { type: Number, min: 0, max: 255, default: 1 },
    lastAccessSyncAt: { type: Date, default: null },
    lastAccessSyncSummary: { type: String, default: null },
  },
  { timestamps: true },
);

accessDeviceSchema.index({ host: 1, port: 1 }, { unique: true });

const attendanceLogSchema = new Schema<TAttendanceLog>(
  {
    branchId: {
      type: Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
    },
    deviceId: {
      type: Schema.Types.ObjectId,
      ref: "AccessDevice",
      required: true,
    },
    deviceUserId: { type: String, required: true, trim: true },
    deviceUserKey: { type: String, required: true, trim: true },
    kind: {
      type: String,
      enum: ["member", "staff", "unlinked"],
      required: true,
    },
    memberRef: { type: Schema.Types.ObjectId, ref: "Member", default: null },
    memberId: { type: String, default: null },
    punchTime: { type: Date, required: true },
    attendanceDate: { type: String, required: true },
    verifyMode: {
      type: String,
      enum: ["fingerprint", "card", "other"],
      default: "other",
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// Re-pulling the same device log must never create duplicates.
attendanceLogSchema.index(
  { deviceId: 1, deviceUserId: 1, punchTime: 1 },
  { unique: true },
);
attendanceLogSchema.index({ branchId: 1, attendanceDate: 1 });
attendanceLogSchema.index({ memberRef: 1, attendanceDate: 1 });

export const AccessDevice = model<TAccessDevice>(
  "AccessDevice",
  accessDeviceSchema,
);
export const AttendanceLog = model<TAttendanceLog>(
  "AttendanceLog",
  attendanceLogSchema,
);
