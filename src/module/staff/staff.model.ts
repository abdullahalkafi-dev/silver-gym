import { Schema, model } from "mongoose";

import { TStaff } from "./staff.interface";
import { Role } from "../role/role.model";

const staffSchema = new Schema<TStaff>(
  {
    branchId: {
      type: Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
      index: true,
    },
    assignedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },
    roleId: {
      type: Schema.Types.ObjectId,
      ref: "Role",
      required: true,
      index: true,
    },
    username: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
      index: true,
    },
    displayName: {
      type: String,
      trim: true,
    },
    password: {
      type: String,
      select: false,
    },
    email: {
      type: String,
      lowercase: true,
      trim: true,
    },
    phone: {
      type: String,
      trim: true,
    },
    profilePicture: {
      type: String,
    },
    lastLogin: {
      type: Date,
    },
    assignedAt: {
      type: Date,
      default: Date.now,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  },
);

staffSchema.pre("validate", async function () {
  if (!this.roleId || !this.branchId) {
    return;
  }

  if (
    !this.isNew &&
    !this.isModified("roleId") &&
    !this.isModified("branchId")
  ) {
    return;
  }

  // Ensure role belongs to the branch
  const role = await Role.findById(this.roleId).select("_id branchId").lean();

  if (!role) {
    throw new Error("Selected role does not exist.");
  }

  if (role.branchId.toString() !== this.branchId.toString()) {
    throw new Error("Selected role must belong to the same branch as staff.");
  }
});

staffSchema.index({ branchId: 1, isActive: 1 });
staffSchema.index({ username: 1 }, { unique: true, sparse: true });

export const Staff = model<TStaff>("Staff", staffSchema);
