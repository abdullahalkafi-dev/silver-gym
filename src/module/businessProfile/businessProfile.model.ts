import { Schema, model } from "mongoose";

import { BusinessType, TBusinessProfile } from "./businessProfile.interface";

const businessProfileSchema = new Schema<TBusinessProfile>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
      unique: true,
    },
    logo: {
      type: String,
    },
    businessName: {
      type: String,
      required: true,
      trim: true,
    },
    businessType: {
      type: String,
      enum: Object.values(BusinessType),
      required: true,
    },
    registrationNumber: {
      type: String,
      trim: true,
    },
    country: {
      type: String,
      trim: true,
    },
    city: {
      type: String,
      trim: true,
    },
    zip: {
      type: String,
      trim: true,
    },
    businessAddress: {
      type: String,
      trim: true,
    },
    businessPhoneNumber: {
      type: String,
      trim: true,
    },
    businessEmail: {
      type: String,
      lowercase: true,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

export const BusinessProfile = model<TBusinessProfile>(
  "BusinessProfile",
  businessProfileSchema
);
