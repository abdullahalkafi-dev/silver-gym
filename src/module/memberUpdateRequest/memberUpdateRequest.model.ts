import { Schema, model } from "mongoose";

export const UPDATE_REQUEST_STATUSES = [
  "pending",
  "processing",
  "approved",
  "partially_approved",
  "rejected",
  "cancelled",
] as const;

export type TUpdateRequestStatus = (typeof UPDATE_REQUEST_STATUSES)[number];

const memberUpdateRequestSchema = new Schema(
  {
    branchId: { type: Schema.Types.ObjectId, ref: "Branch", required: true, index: true },
    // No `index: true` here: it would claim the name "memberId_1" first and the
    // unique partial index below would silently never be created.
    memberId: { type: Schema.Types.ObjectId, ref: "Member", required: true },
    status: {
      type: String,
      enum: UPDATE_REQUEST_STATUSES,
      default: "pending",
      index: true,
    },
    /**
     * Only the fields the member actually touched: { fieldKey: { old, new } }.
     * `old` is the member's value when the request was made/merged (null when empty).
     * A field that is not here was NOT requested and is never touched on approval.
     */
    changes: { type: Schema.Types.Mixed, default: {} },
    /** Pending photo (object key in storage) and the photo it would replace. */
    photo: {
      type: new Schema(
        { newKey: { type: String }, oldKey: { type: String } },
        { _id: false },
      ),
      default: undefined,
    },
    /** Review result per field: { fieldKey|photo: "accepted" | "rejected" }. */
    resolution: { type: Schema.Types.Mixed },
    reviewedBy: {
      type: new Schema(
        {
          kind: { type: String, enum: ["owner", "staff"] },
          id: { type: Schema.Types.ObjectId },
        },
        { _id: false },
      ),
      default: undefined,
    },
    reviewedAt: { type: Date },
    reviewNote: { type: String, trim: true },
  },
  { timestamps: true },
);

// At most one open request per member.
memberUpdateRequestSchema.index(
  { memberId: 1 },
  {
    name: "one_open_request_per_member",
    unique: true,
    partialFilterExpression: { status: { $in: ["pending", "processing"] } },
  },
);
// Past requests of one member (history, latest result).
memberUpdateRequestSchema.index({ memberId: 1, status: 1 });

export const MemberUpdateRequest = model("MemberUpdateRequest", memberUpdateRequestSchema);
