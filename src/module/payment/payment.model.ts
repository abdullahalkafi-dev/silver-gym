import { Schema, model } from "mongoose";

import { PaymentMethod, PaymentStatus, PaymentType, TPayment } from "./payment.interface";
import { Member } from "../member/member.model";
import { Package } from "../package/package.model";

const paymentSchema = new Schema<TPayment>(
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
    invoiceNo: {
      type: String,
      trim: true,
    },
    memberId: {
      type: Schema.Types.ObjectId,
      ref: "Member",
      sparse: true,
      index: true,
    },
    memberLegacyId: {
      type: String,
      trim: true,
    },
    memberName: {
      type: String,
      trim: true,
    },
    packageId: {
      type: Schema.Types.ObjectId,
      ref: "Package",
      index: true,
    },
    packageLegacyId: {
      type: String,
      trim: true,
    },
    packageName: {
      type: String,
      trim: true,
    },
    packageDuration: {
      type: Number,
      min: 0,
    },
    packageDurationType: {
      type: String,
      trim: true,
    },
    paymentType: {
      type: String,
      trim: true,
      enum: Object.values(PaymentType),
    },
    periodStart: {
      type: Date,
    },
    periodEnd: {
      type: Date,
    },
    paidMonths: {
      type: Number,
      min: 0,
    },
    year: {
      type: Number,
      min: 2000,
    },
    subTotal: {
      type: Number,
      min: 0,
    },
    discount: {
      type: Number,
      min: 0,
    },
    dueAmount: {
      type: Number,
      min: 0,
    },
    advanceAmount: {
      type: Number,
      min: 0,
      default: 0,
    },
    paidTotal: {
      type: Number,
      min: 0,
    },
    admissionFee: {
      type: Number,
      min: 0,
    },
    paymentMethod: {
      type: String,
      enum: Object.values(PaymentMethod),
      trim: true,
    },
    paymentDate: {
      type: Date,
    },
    nextPaymentDate: {
      type: Date,
    },
    status: {
      type: String,
      trim: true,
      enum: Object.values(PaymentStatus),
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
  },
);

paymentSchema.pre("validate", async function () {
  if (!this.branchId) {
    return;
  }

  const shouldCheckMember =
    this.memberId &&
    (this.isNew || this.isModified("memberId") || this.isModified("branchId"));
  if (shouldCheckMember) {
    const member = await Member.findById(this.memberId)
      .select("_id branchId")
      .lean();
    if (!member) {
      throw new Error("Selected member does not exist.");
    }

    if (member.branchId.toString() !== this.branchId.toString()) {
      throw new Error(
        "Selected member must belong to the same branch as payment.",
      );
    }
  }

  const shouldCheckPackage =
    this.packageId &&
    (this.isNew || this.isModified("packageId") || this.isModified("branchId"));
  if (shouldCheckPackage) {
    const pkg = await Package.findById(this.packageId)
      .select("_id branchId")
      .lean();
    if (!pkg) {
      throw new Error("Selected package does not exist.");
    }

    if (pkg.branchId.toString() !== this.branchId.toString()) {
      throw new Error(
        "Selected package must belong to the same branch as payment.",
      );
    }
  }
});

paymentSchema.index({ branchId: 1, memberId: 1, importBatchId: 1 });
paymentSchema.index({ branchId: 1, memberLegacyId: 1, importBatchId: 1 });

export const Payment = model<TPayment>("Payment", paymentSchema);
