import { Schema, model } from "mongoose";

import { PackageDurationType, TPackage } from "./package.interface";

const packageSchema = new Schema<TPackage>(
  {
    branchId: {
      type: Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
      index: true,
    },
    legacyId: {
      type: String,
      trim: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    duration: {
      type: Number,
      required: true,
      min: 1,
    },
    durationType: {
      type: String,
      required: true,
      trim: true,
      enum: Object.values(PackageDurationType),
    },
    description: {
      type: String,
      trim: true,
    },
    color: {
      type: String,
      trim: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    includeAdmissionFee: {
      type: Boolean,
      default: false,
    },
    admissionFeeAmount: {
      type: Number,
      min: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    source: {
      type: String,
      trim: true,
    },
    metadata: {
      type: Schema.Types.Mixed,
    },
  },
  {
    timestamps: true,
  }
);

export const Package = model<TPackage>("Package", packageSchema);
