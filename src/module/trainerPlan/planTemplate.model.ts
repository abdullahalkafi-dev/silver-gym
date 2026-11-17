import { Schema, model } from "mongoose";

/** A trainer's own reusable plan. Private: only that trainer can see or use it. */
const planTemplateSchema = new Schema(
  {
    trainerId: { type: Schema.Types.ObjectId, ref: "Trainer", required: true },
    branchId: { type: Schema.Types.ObjectId, ref: "Branch", required: true },
    title: { type: String, required: true, trim: true },
    content: { type: String, required: true },
  },
  { timestamps: true },
);

planTemplateSchema.index({ trainerId: 1, updatedAt: -1 });

export const PlanTemplate = model("PlanTemplate", planTemplateSchema);
