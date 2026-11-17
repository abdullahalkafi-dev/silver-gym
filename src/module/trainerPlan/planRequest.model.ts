import { Schema, model } from "mongoose";

import { PLAN_REQUEST_STATUSES } from "./trainerPlan.constants";

/** The member's details at the moment they asked (what the trainer planned for). */
const memberSnapshotSchema = new Schema(
  {
    fullName: { type: String, trim: true },
    memberId: { type: String, trim: true },
    photo: { type: String },
    gender: { type: String, trim: true },
    age: { type: Number },
    bloodGroup: { type: String, trim: true },
    height: { type: Number },
    heightUnit: { type: String, trim: true },
    weight: { type: Number },
    weightUnit: { type: String, trim: true },
    trainingGoals: { type: [String], default: undefined },
  },
  { _id: false },
);

const replySchema = new Schema(
  {
    title: { type: String, trim: true },
    content: { type: String, required: true },
    sentAt: { type: Date, required: true },
    editedAt: { type: Date },
  },
  { _id: false },
);

const planRequestSchema = new Schema(
  {
    branchId: { type: Schema.Types.ObjectId, ref: "Branch", required: true },
    // No `index: true` on memberId: the named unique partial index below uses the same key.
    memberId: { type: Schema.Types.ObjectId, ref: "Member", required: true },
    trainerId: { type: Schema.Types.ObjectId, ref: "Trainer", required: true },
    trainerName: { type: String, trim: true },
    topic: { type: String, required: true, trim: true },
    isCustomTopic: { type: Boolean, default: false },
    note: { type: String, trim: true },
    memberSnapshot: { type: memberSnapshotSchema, required: true },
    status: { type: String, enum: PLAN_REQUEST_STATUSES, default: "pending" },
    reply: { type: replySchema, default: undefined },
    declineReason: { type: String, trim: true },
    closedAt: { type: Date },
  },
  { timestamps: true },
);

// A member can wait on only one request at a time.
planRequestSchema.index(
  { memberId: 1 },
  {
    name: "one_open_plan_request_per_member",
    unique: true,
    partialFilterExpression: { status: "pending" },
  },
);
planRequestSchema.index({ memberId: 1, createdAt: -1 });
// Trainer inbox and dashboard counts / lists.
planRequestSchema.index({ trainerId: 1, status: 1, createdAt: -1 });
planRequestSchema.index({ branchId: 1, trainerId: 1, createdAt: -1 });

export const PlanRequest = model("PlanRequest", planRequestSchema);
