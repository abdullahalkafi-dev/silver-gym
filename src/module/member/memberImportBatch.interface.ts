import { Types } from "mongoose";

export type TMemberImportSource = "google_sheet";

export type TMemberImportStatus =
  | "pending"
  | "processing"
  | "completed"
  | "partial_failed"
  | "failed"
  | "cancelled";

export interface TMemberImportFailureRow {
  rowIndex: number;
  reason: string;
  memberName?: string;
  raw?: Record<string, unknown>;
}

export interface TMemberImportBatch {
  branchId: Types.ObjectId;
  source: TMemberImportSource;
  spreadsheetId: string;
  range: string;
  status: TMemberImportStatus;
  createdByUserId?: Types.ObjectId;
  createdByStaffId?: Types.ObjectId;
  retryOfBatchId?: Types.ObjectId;
  cancelRequested?: boolean;
  startedAt?: Date | null;
  endedAt?: Date | null;
  totalRows?: number;
  processedRows?: number;
  successRows?: number;
  failedRows?: number;
  warningRows?: number;
  cursor?: number;
  failuresPreview?: TMemberImportFailureRow[];
  warningsPreview?: TMemberImportFailureRow[];
  failedRowsData?: TMemberImportFailureRow[];
  retryRows?: Record<string, unknown>[];
  metadata?: Record<string, unknown>;
  createdAt?: Date;
  updatedAt?: Date;
}
