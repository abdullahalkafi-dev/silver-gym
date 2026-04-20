import { Schema, model } from "mongoose";

import { TBranch } from "./branch.interface";

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
