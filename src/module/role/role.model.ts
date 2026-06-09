import { Schema, model } from "mongoose";

import { TRole } from "./role.interface";

const roleSchema = new Schema<TRole>(
  {
    branchId: {
      type: Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
      index: true,
    },
    roleName: {
      type: String,
      required: true,
      trim: true,
    },
    canManageMembers: { type: Boolean, default: false },
    canManagePackages: { type: Boolean, default: false },
    canManagePayments: { type: Boolean, default: false },
    canManageBilling: { type: Boolean, default: false },
    canManageExpenses: { type: Boolean, default: false },
    canManageLockers: { type: Boolean, default: false },
  },
  {
    timestamps: true,
  }
);

export const Role = model<TRole>("Role", roleSchema);
