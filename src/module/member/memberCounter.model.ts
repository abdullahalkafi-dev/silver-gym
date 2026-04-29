import { Schema, model } from "mongoose";
import { Types } from "mongoose";

interface TMemberCounter {
  branchId: Types.ObjectId;
  lastSystemMemberId: number;
}

const memberCounterSchema = new Schema<TMemberCounter>(
  {
    branchId: {
      type: Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
      unique: true,
      index: true,
    },
    lastSystemMemberId: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
  },
);

export const MemberCounter = model<TMemberCounter>("MemberCounter", memberCounterSchema);
