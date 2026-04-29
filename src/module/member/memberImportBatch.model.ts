import { Schema, model } from "mongoose";

import {
  TMemberImportBatch,
  TMemberImportFailureRow,
} from "./memberImportBatch.interface";

const failureRowSchema = new Schema<TMemberImportFailureRow>(
  {
    rowIndex: {
      type: Number,
      required: true,
    },
    reason: {
      type: String,
      required: true,
      trim: true,
    },
    memberName: {
      type: String,
      trim: true,
    },
    raw: {
      type: Schema.Types.Mixed,
    },
  },
  { _id: false },
);

const memberImportBatchSchema = new Schema<TMemberImportBatch>(
  {
    branchId: {
      type: Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
      index: true,
    },
    source: {
      type: String,
      enum: ["google_sheet", "csv_upload"],
      required: true,
      trim: true,
    },
    spreadsheetId: {
      type: String,
      trim: true,
    },
    range: {
      type: String,
      trim: true,
    },
    status: {
      type: String,
      enum: [
        "pending",
        "processing",
        "completed",
        "partial_failed",
        "failed",
        "cancelled",
      ],
      required: true,
      default: "pending",
      index: true,
    },
    errorMessage: {
      type: String,
      trim: true,
    },
    createdByUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },
    createdByStaffId: {
      type: Schema.Types.ObjectId,
      ref: "Staff",
      index: true,
    },
    retryOfBatchId: {
      type: Schema.Types.ObjectId,
      ref: "MemberImportBatch",
      index: true,
    },
    cancelRequested: {
      type: Boolean,
      default: false,
      index: true,
    },
    startedAt: {
      type: Date,
      default: null,
    },
    endedAt: {
      type: Date,
      default: null,
    },
    totalRows: {
      type: Number,
      min: 0,
      default: 0,
    },
    processedRows: {
      type: Number,
      min: 0,
      default: 0,
    },
    successRows: {
      type: Number,
      min: 0,
      default: 0,
    },
    failedRows: {
      type: Number,
      min: 0,
      default: 0,
    },
    warningRows: {
      type: Number,
      min: 0,
      default: 0,
    },
    cursor: {
      type: Number,
      min: 0,
      default: 0,
    },
    failuresPreview: {
      type: [failureRowSchema],
      default: [],
    },
    warningsPreview: {
      type: [failureRowSchema],
      default: [],
    },
    failedRowsData: {
      type: [failureRowSchema],
      default: [],
    },
    retryRows: {
      type: [Schema.Types.Mixed],
      default: [],
    },
    csvData: {
      type: [Schema.Types.Mixed],
      default: [],
    },
    metadata: {
      type: Schema.Types.Mixed,
    },
  },
  {
    timestamps: true,
  },
);

memberImportBatchSchema.index({ branchId: 1, status: 1, createdAt: -1 });
memberImportBatchSchema.index({ branchId: 1, cancelRequested: 1, status: 1 });

export const MemberImportBatch = model<TMemberImportBatch>(
  "MemberImportBatch",
  memberImportBatchSchema,
);
