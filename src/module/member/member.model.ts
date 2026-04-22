import { Schema, model } from "mongoose";

import { TMember, emergencyContact } from './member.interface';
import { Package } from "../package/package.model";

const TRAINING_GOALS = [
  "Yoga",
  "Cardio Endurance",
  "Bodybuilding",
  "Muscle Gain",
  "Flexibility & Mobility",
  "General Fitness",
  "Strength Training",
] as const;

const emergencyContactSchema = new Schema<emergencyContact>(
  {

    relationship: {
        type: String,
        trim: true,
    },
    contactNumber: {
        type: String,   
        trim: true,
    },
  },
  { _id: false }
);


const memberSchema = new Schema<TMember>(
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
    },
    memberId: {
      type: String,
      trim: true,
    },
    barcode: {
      type: String,
      trim: true,
    },
    fullName: {
      type: String,
      required: true,
      trim: true,
    },
    contact: {
      type: String,
      trim: true,
    },
    email: {
      type: String,
      lowercase: true,
      trim: true,
    },
    dateOfBirth: {
      type: Date,
    },
    country: {
      type: String,
      trim: true,
    },
    nid: {
      type: String,
      trim: true,
    },
    gender: {
      type: String,
      trim: true,
    },
    bloodGroup: {
      type: String,
      trim: true,
    },
    height: {
      type: Number,
      min: 0,
    },
    heightUnit: {
      type: String,
      enum: ["cm", "in", "ft"],
      trim: true,
    },
    weight: {
      type: Number,
      min: 0,
    },
    weightUnit: {
      type: String,
      enum: ["kg", "lb"],
      trim: true,
    },
    address: {
      type: String,
      trim: true,
    },
    photo: {
      type: String,
    },
    emergencyContact: {
      type: emergencyContactSchema,
    },
    trainingGoals: {
      type: [String],
      enum: TRAINING_GOALS,
      default: [],
    },
    currentPackageId: {
      type: Schema.Types.ObjectId,
      ref: "Package",
    },
    currentPackageName: {
      type: String,
      trim: true,
    },
    membershipStartDate: {
      type: Date,
    },
    membershipEndDate: {
      type: Date,
    },
    nextPaymentDate: {
      type: Date,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    isCustomMonthlyFee: {
      type: Boolean,
      default: false,
    },
    customMonthlyFeeAmount: {
      type: Number,
      min: 0,
    },
    paidMonths: {
      type: Number,
      min: 0,
    },
    currentDueAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    currentAdvanceAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    source: {
      type: String,
      trim: true,
    },
    importBatchId: {
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

memberSchema.pre("validate", async function () {
  if (this.isCustomMonthlyFee) {
    if (this.customMonthlyFeeAmount == null) {
      throw new Error("customMonthlyFeeAmount is required when isCustomMonthlyFee is true.");
    }
  } else if (this.customMonthlyFeeAmount != null) {
    throw new Error("customMonthlyFeeAmount can only be set when isCustomMonthlyFee is true.");
  }

  // NOTE: isCustomMonthlyFee + customMonthlyFeeAmount CAN coexist with currentPackageId.
  // They represent the member's personal rate that will apply after the package ends.
  if (!this.currentPackageId || !this.branchId) {
    return;
  }

  if (!this.isNew && !this.isModified("currentPackageId") && !this.isModified("branchId")) {
    return;
  }

  const pkg = await Package.findById(this.currentPackageId).select("_id branchId").lean();

  if (!pkg) {
    throw new Error("Selected package does not exist.");
  }

  if (pkg.branchId.toString() !== this.branchId.toString()) {
    throw new Error("Selected package must belong to the same branch as member.");
  }
});

memberSchema.index({ branchId: 1, isActive: 1, createdAt: -1 });
memberSchema.index(
  { branchId: 1, legacyId: 1 },
  {
    unique: true,
    partialFilterExpression: { legacyId: { $exists: true, $ne: null } },
  },
);

export const Member = model<TMember>("Member", memberSchema);
