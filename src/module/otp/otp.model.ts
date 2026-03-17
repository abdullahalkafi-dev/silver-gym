import {  model, Schema } from "mongoose";
import { TOTP } from "./otp.interface";





// Schema
const otpSchema = new Schema<TOTP>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    otp: {
      type: String,
      required: true,
      select: false,
    },
    type: {
      type: String,
      enum: ["account_verification", "password_reset", "two_factor"],
      required: true,
    },
    provider: {
      type: String,
      enum: ["email", "phone"],
      required: true,
    },
    target: {
      type: String,
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 },
    },
    attempts: {
      type: Number,
      default: 0,
      min: 0,
    },
    maxAttempts: {
      type: Number,
      default: 5,
      min: 1,
    },
    isUsed: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  },
);

// Compound index for faster queries
otpSchema.index({ userId: 1, type: 1, isUsed: 1 });

export const OTP = model("OTP", otpSchema);
