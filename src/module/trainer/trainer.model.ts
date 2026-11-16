import { InferSchemaType, Schema, model } from "mongoose";

const trainerSchema = new Schema(
  {
    branchId: {
      type: Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
      index: true,
    },
    username: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
    },
    displayName: { type: String, trim: true, required: true },
    phone: { type: String, trim: true },
    password: { type: String, select: false, required: true },
    isActive: { type: Boolean, default: true },
    lastLogin: { type: Date },
  },
  { timestamps: true },
);

trainerSchema.index({ branchId: 1, isActive: 1 });

export type TTrainer = InferSchemaType<typeof trainerSchema>;
export const Trainer = model("Trainer", trainerSchema);
