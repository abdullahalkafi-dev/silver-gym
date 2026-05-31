import { Schema, model } from "mongoose";

interface TSchedulerLock {
  name: string;
  lockedAt: Date;
  expiresAt: Date;
  lockedBy: string;
}

const schedulerLockSchema = new Schema<TSchedulerLock>(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    lockedAt: {
      type: Date,
      default: Date.now,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    lockedBy: {
      type: String,
      required: true,
    },
  },
  { timestamps: false },
);

schedulerLockSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const SchedulerLock = model<TSchedulerLock>(
  "SchedulerLock",
  schedulerLockSchema,
);
