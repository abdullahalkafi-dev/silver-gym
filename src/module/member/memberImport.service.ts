import { google } from "googleapis";
import { StatusCodes } from "http-status-codes";
import { Types } from "mongoose";

import config from "../../config";
import AppError from "../../errors/AppError";
import { errorLogger, logger } from "../../logger/logger";
import { BranchRepository } from "../branch/branch.repository";
import { BusinessProfileRepository } from "../businessProfile/businessProfile.repository";
import { TStaff } from "../staff/staff.interface";
import { TMember } from "./member.interface";
import {
  TMemberImportBatch,
  TMemberImportFailureRow,
  TMemberImportStatus,
} from "./memberImportBatch.interface";
import { MemberImportBatchRepository } from "./memberImportBatch.repository";
import { MemberRepository } from "./member.repository";

type TImportActor = {
  userId?: Types.ObjectId;
  staff?: TStaff;
};

type TStartGoogleSheetImportPayload = {
  spreadsheetId: string;
  range?: string;
};

type TListImportBatchQuery = {
  page?: unknown;
  limit?: unknown;
  status?: unknown;
};

type TImportMetricsQuery = {
  days?: unknown;
};

type TRawImportRow = Record<string, unknown>;

type TProcessRowResult = {
  type: "success" | "failed";
  warning?: TMemberImportFailureRow;
  failure?: TMemberImportFailureRow;
};

type TImportRuntimeConfig = {
  chunkSize: number;
  maxPreviewRows: number;
  maxFailedRowsData: number;
  maxRowsPerBatch: number;
};

const activeBranchImports = new Set<string>();
const queuedBatchIds = new Set<string>();
const importQueue: string[] = [];
let queueRunning = false;

const IMPORT_STATUS_SET = new Set<TMemberImportStatus>([
  "pending",
  "processing",
  "completed",
  "partial_failed",
  "failed",
  "cancelled",
]);

const getRuntimeConfig = (): TImportRuntimeConfig => {
  const imports = config.imports;

  const chunkSize = Number(imports.chunk_size || 50);
  const maxPreviewRows = Number(imports.max_preview_rows || 200);
  const maxFailedRowsData = Number(imports.max_failed_rows_data || 500);
  const maxRowsPerBatch = Number(imports.max_rows_per_batch || 5000);

  return {
    chunkSize: Number.isFinite(chunkSize) && chunkSize > 0 ? chunkSize : 50,
    maxPreviewRows:
      Number.isFinite(maxPreviewRows) && maxPreviewRows > 0 ? maxPreviewRows : 200,
    maxFailedRowsData:
      Number.isFinite(maxFailedRowsData) && maxFailedRowsData > 0
        ? maxFailedRowsData
        : 500,
    maxRowsPerBatch:
      Number.isFinite(maxRowsPerBatch) && maxRowsPerBatch > 0 ? maxRowsPerBatch : 5000,
  };
};

const normalizeKey = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const toStringValue = (value: unknown): string | undefined => {
  if (value == null) {
    return undefined;
  }

  const parsed = String(value).trim();
  return parsed.length > 0 ? parsed : undefined;
};

const toNumberValue = (value: unknown): number | undefined => {
  if (value == null) {
    return undefined;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  const cleaned = String(value).replace(/,/g, "").trim();
  if (!cleaned) {
    return undefined;
  }

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const pickValue = (row: TRawImportRow, keys: string[]): unknown => {
  for (const key of keys) {
    if (key in row) {
      return row[key];
    }
  }

  return undefined;
};

const parseFlexibleDate = (value: unknown): Date | undefined => {
  if (value == null) return undefined;
  
  const str = String(value).trim();
  if (!str) return undefined;

  // Try standard Date parsing first
  const standard = new Date(str);
  if (!Number.isNaN(standard.getTime())) return standard;

  // Try "Month-Year" or "Month Year" format (e.g., "October-2026", "June 2026")
  const monthYearMatch = str.match(/^([a-zA-Z]+)[-\s]?(\d{4})$/);
  if (monthYearMatch && monthYearMatch[1] && monthYearMatch[2]) {
    const monthStr = monthYearMatch[1];
    const yearStr = monthYearMatch[2];
    const months = ['january', 'february', 'march', 'april', 'may', 'june',
                    'july', 'august', 'september', 'october', 'november', 'december'];
    const monthIndex = months.indexOf(monthStr.toLowerCase());
    if (monthIndex >= 0) {
      return new Date(parseInt(yearStr), monthIndex, 1);
    }
  }
  
  return undefined;
};

const validateUniqueMemberIds = (
  rows: TRawImportRow[]
): { valid: boolean; duplicates: { memberId: string; rowIndices: number[] }[] } => {
  const memberIdMap = new Map<string, number[]>();
  
  rows.forEach((row, index) => {
    const memberId = toStringValue(pickValue(row, ['member_id', 'memberid']));
    if (memberId) {
      const existing = memberIdMap.get(memberId) || [];
      existing.push(index + 2); // +2 for header row offset
      memberIdMap.set(memberId, existing);
    }
  });
  
  const duplicates: { memberId: string; rowIndices: number[] }[] = [];
  memberIdMap.forEach((indices, memberId) => {
    if (indices.length > 1) {
      duplicates.push({ memberId, rowIndices: indices });
    }
  });
  
  return { valid: duplicates.length === 0, duplicates };
};

const calculateDueAmount = (
  nextPaymentDate: Date,
  monthlyFee: number,
  sheetDueAmount: number,
  isActive: boolean
): { dueAmount: number; updatedNextPaymentDate: Date } => {
  const now = new Date();
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  
  // If next payment is in the future or member is inactive, use sheet's due amount
  if (nextPaymentDate >= currentMonthStart || !isActive) {
    return { 
      dueAmount: sheetDueAmount,
      updatedNextPaymentDate: nextPaymentDate 
    };
  }
  
  // Calculate FULL months from nextPaymentDate to current month
  const monthsDiff = (now.getFullYear() - nextPaymentDate.getFullYear()) * 12 +
                     (now.getMonth() - nextPaymentDate.getMonth());
  
  // Due = (full months × monthlyFee) + sheet's initial due
  const accumulatedDue = monthsDiff * monthlyFee;
  const totalDue = accumulatedDue + sheetDueAmount;
  
  // Update next payment to current month + 1
  const updatedNextPaymentDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  
  return { dueAmount: Math.max(0, totalDue), updatedNextPaymentDate };
};

const resolveBranchAccess = async (branchId: string, actor: TImportActor) => {
  const branch = await BranchRepository.findOne({
    _id: new Types.ObjectId(branchId),
    isActive: true,
  });

  if (!branch) {
    throw new AppError(StatusCodes.NOT_FOUND, "Branch not found");
  }

  if (actor.userId) {
    const business = await BusinessProfileRepository.findOne({
      _id: branch.businessId,
      userId: actor.userId,
    });

    if (!business) {
      throw new AppError(
        StatusCodes.FORBIDDEN,
        "You do not have permission to access this branch",
      );
    }

    return branch;
  }

  if (actor.staff) {
    if (!actor.staff.isActive) {
      throw new AppError(StatusCodes.FORBIDDEN, "Staff account is inactive");
    }

    if (String(actor.staff.branchId) !== String(branch._id)) {
      throw new AppError(
        StatusCodes.FORBIDDEN,
        "You do not have permission to access this branch",
      );
    }

    return branch;
  }

  throw new AppError(StatusCodes.UNAUTHORIZED, "You are not authorized");
};

const ensureGoogleSheetsConfig = () => {
  if (!config.google.service_account_email || !config.google.private_key) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "Google Sheets credentials are not configured",
    );
  }
};

/**
 * Parse CSV file content into rows with normalized headers
 * Handles both comma and semicolon delimiters, with or without quotes
 */
const parseCSVContent = (content: string): TRawImportRow[] => {
  const lines = content.split("\n").filter((line) => line.trim().length > 0);

  if (lines.length === 0) {
    return [];
  }

  // Detect delimiter (comma or semicolon)
  const headerLine = lines[0] || "";
  const hasComma = headerLine.includes(",");
  const hasSemicolon = headerLine.includes(";");
  const delimiter = hasSemicolon && !hasComma ? ";" : ",";

  // Parse CSV line by line, handling quoted values
  const parseCSVLine = (line: string): string[] => {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const nextChar = line[i + 1];

      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          current += '"';
          i++; // Skip next quote
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === delimiter && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }

    result.push(current.trim());
    return result;
  };

  const headerRow = parseCSVLine(lines[0] || "");
  const headers = headerRow.map((header, index) => {
    const normalized = normalizeKey(header);
    return normalized || `column_${index + 1}`;
  });

  return lines
    .slice(1)
    .map((line) => {
      const values = parseCSVLine(line);
      const normalized: TRawImportRow = {};
      headers.forEach((header, index) => {
        normalized[header] = values[index];
      });
      return normalized;
    })
    .filter((row) => Object.values(row).some((value) => toStringValue(value) !== undefined));
};

const getSheetRows = async (
  spreadsheetId: string,
  range: string,
): Promise<TRawImportRow[]> => {
  ensureGoogleSheetsConfig();

  const privateKey = config.google.private_key;

  if (!privateKey) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "Google Sheets private key is not configured",
    );
  }

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: config.google.service_account_email,
      private_key: privateKey.replace(/\\n/g, "\n"),
    },
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  const sheets = google.sheets({ version: "v4", auth });
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
  });

  const values = response.data.values || [];

  if (values.length === 0) {
    return [];
  }

  const headerRow = values[0] || [];
  const headers = headerRow.map((header, index) => {
    const normalized = normalizeKey(header);
    return normalized || `column_${index + 1}`;
  });

  return values
    .slice(1)
    .map((row) => {
      const normalized: TRawImportRow = {};
      headers.forEach((header, index) => {
        normalized[header] = row[index];
      });
      return normalized;
    })
    .filter((row) => Object.values(row).some((value) => toStringValue(value) !== undefined));
};

const buildMemberUpsertFilter = (
  branchObjectId: Types.ObjectId,
  row: {
    legacyId?: string;
    memberId?: string;
    barcode?: string;
    email?: string;
    contact?: string;
    fullName: string;
  },
): Record<string, unknown> | null => {
  if (row.legacyId) {
    return {
      branchId: branchObjectId,
      legacyId: row.legacyId,
    };
  }

  if (row.memberId) {
    return {
      branchId: branchObjectId,
      memberId: row.memberId,
    };
  }

  if (row.barcode) {
    return {
      branchId: branchObjectId,
      barcode: row.barcode,
    };
  }

  if (row.email) {
    return {
      branchId: branchObjectId,
      email: row.email,
    };
  }

  if (row.contact) {
    return {
      branchId: branchObjectId,
      contact: row.contact,
      fullName: row.fullName,
    };
  }

  return null;
};

const persistMember = async (
  branchObjectId: Types.ObjectId,
  memberData: TMember,
  identifier: {
    legacyId?: string;
    memberId?: string;
    barcode?: string;
    email?: string;
    contact?: string;
    fullName: string;
  },
) => {
  const filter = buildMemberUpsertFilter(branchObjectId, identifier);

  if (!filter) {
    return MemberRepository.create(memberData);
  }

  const existing = await MemberRepository.findOne(filter);

  if (!existing) {
    return MemberRepository.create(memberData);
  }

  const updated = await MemberRepository.updateById(String(existing._id), memberData);

  if (!updated) {
    throw new AppError(StatusCodes.INTERNAL_SERVER_ERROR, "Failed to update imported member");
  }

  return updated;
};

const processRow = async (
  branchId: string,
  batchId: string,
  rowIndex: number,
  row: TRawImportRow,
  branchMonthlyFee: number,
): Promise<TProcessRowResult> => {
  const branchObjectId = new Types.ObjectId(branchId);

  // Required: name
  const fullName = toStringValue(
    pickValue(row, ["full_name", "fullname", "name", "member_name"]),
  );
  if (!fullName) {
    return {
      type: "failed",
      failure: { rowIndex, reason: "Name is required", raw: row },
    };
  }

  // Required: phone OR email
  const contact = toStringValue(
    pickValue(row, ["contact", "phone", "mobile", "phone_number"]),
  );
  const email = toStringValue(pickValue(row, ["email", "mail"]))?.toLowerCase();
  
  if (!contact && !email) {
    return {
      type: "failed",
      failure: { rowIndex, reason: "Phone number or email is required", raw: row },
    };
  }

  // MemberId (validated for uniqueness at batch level - both sheet and DB)
  const memberId = toStringValue(pickValue(row, ["member_id", "memberid"]));

  // Monthly fee: use sheet value, fallback to branch default
  const sheetMonthlyFee = toNumberValue(
    pickValue(row, ["monthly_fee", "monthly_fee_amount", "monthlyamount"]),
  );
  const monthlyFeeAmount = sheetMonthlyFee ?? branchMonthlyFee;
  
  if (!monthlyFeeAmount || monthlyFeeAmount <= 0) {
    return {
      type: "failed",
      failure: { rowIndex, reason: "Monthly fee is required (not in sheet or branch settings)", raw: row },
    };
  }

  // Due amount from sheet (initial due)
  const sheetDueAmount = toNumberValue(
    pickValue(row, ["due_amount", "due", "dueamount"]),
  ) || 0;

  // REQUIRED: Next payment date (flexible parsing)
  const nextPaymentDateRaw = pickValue(row, [
    "next_payment_date", "next_payment", "nextpaymentdate", "payment_date"
  ]);
  const nextPaymentDate = parseFlexibleDate(nextPaymentDateRaw);
  
  if (!nextPaymentDate) {
    return {
      type: "failed",
      failure: { rowIndex, reason: "NextPaymentDate is required", raw: row },
    };
  }

  // Status (active/inactive)
  const statusRaw = toStringValue(pickValue(row, ["status", "member_status"]));
  const isActive = statusRaw?.toLowerCase() !== "inactive";

  // Calculate dues (full months only)
  const { dueAmount, updatedNextPaymentDate } = calculateDueAmount(
    nextPaymentDate,
    monthlyFeeAmount,
    sheetDueAmount,
    isActive
  );

  const memberData: TMember = {
    branchId: branchObjectId,
    legacyId: memberId,
    memberId,
    fullName,
    contact,
    email,
    monthlyFeeAmount,
    customMonthlyFee: true,
    nextPaymentDate: updatedNextPaymentDate,
    currentDueAmount: dueAmount,
    isActive,
    source: "google_sheet",
    importBatchId: batchId,
    metadata: {
      importRowIndex: rowIndex,
      originalNextPaymentDate: nextPaymentDate.toISOString(),
      sheetDueAmount,
    },
  };

  await persistMember(branchObjectId, memberData, {
    memberId,
    email,
    contact,
    fullName,
  });

  return { type: "success" };
};

const waitForEventLoopTurn = async () => {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
};

const enqueueBatch = (batchId: string) => {
  if (queuedBatchIds.has(batchId)) {
    return;
  }

  queuedBatchIds.add(batchId);
  importQueue.push(batchId);
};

const removeBatchFromQueue = (batchId: string) => {
  const index = importQueue.indexOf(batchId);

  if (index >= 0) {
    importQueue.splice(index, 1);
  }

  queuedBatchIds.delete(batchId);
};

const updateBatchProgress = async (
  batchId: string,
  payload: {
    status?: TMemberImportStatus;
    totalRows?: number;
    processedRows?: number;
    successRows?: number;
    failedRows?: number;
    warningRows?: number;
    cursor?: number;
    failuresPreview?: TMemberImportFailureRow[];
    warningsPreview?: TMemberImportFailureRow[];
    failedRowsData?: TMemberImportFailureRow[];
    startedAt?: Date | null;
    endedAt?: Date | null;
  },
) => {
  const updated = await MemberImportBatchRepository.updateById(batchId, payload);

  if (!updated) {
    throw new AppError(StatusCodes.NOT_FOUND, "Import batch not found");
  }

  return updated;
};

const processBatch = async (batchId: string) => {
  const runtimeConfig = getRuntimeConfig();
  const batch = await MemberImportBatchRepository.findById(batchId);

  if (!batch) {
    queuedBatchIds.delete(batchId);
    return;
  }

  const branchKey = String(batch.branchId);
  activeBranchImports.add(branchKey);

  try {
    if (batch.cancelRequested) {
      await updateBatchProgress(batchId, {
        status: "cancelled",
        endedAt: new Date(),
      });
      return;
    }

    await updateBatchProgress(batchId, {
      status: "processing",
      startedAt: batch.startedAt || new Date(),
    });

    const rowsFromSource =
      Array.isArray(batch.retryRows) && batch.retryRows.length > 0
        ? batch.retryRows
        : Array.isArray((batch as any).csvData) && (batch as any).csvData.length > 0
          ? (batch as any).csvData
          : batch.spreadsheetId && batch.range
            ? await getSheetRows(batch.spreadsheetId, batch.range)
            : [];

    if (rowsFromSource.length === 0 && batch.source === "google_sheet") {
      throw new AppError(
        StatusCodes.BAD_REQUEST,
        "No rows found in Google Sheet"
      );
    }

    if (rowsFromSource.length > runtimeConfig.maxRowsPerBatch) {
      throw new AppError(
        StatusCodes.BAD_REQUEST,
        `Maximum import rows exceeded. Limit is ${runtimeConfig.maxRowsPerBatch}`,
      );
    }

    // Get branch monthlyFee for fallback
    const branch = await BranchRepository.findById(String(batch.branchId));
    const branchMonthlyFee = branch?.monthlyFeeAmount || 0;

    // Pre-validate that all rows have monthlyFee OR branch has default
    const rowsMissingFee: number[] = [];
    rowsFromSource.forEach((row: Record<string, unknown>, index: number) => {
      const sheetFee = toNumberValue(pickValue(row, ['monthly_fee', 'monthly_fee_amount', 'monthlyamount']));
      if (!sheetFee && !branchMonthlyFee) {
        rowsMissingFee.push(index + 2); // +2 for header offset
      }
    });

    if (rowsMissingFee.length > 0) {
      await updateBatchProgress(batchId, {
        status: 'failed',
        endedAt: new Date(),
      });
      
      throw new AppError(
        StatusCodes.BAD_REQUEST,
        `Monthly fee missing in rows ${rowsMissingFee.join(', ')} and no branch default set - import aborted`
      );
    }

    // Collect all memberIds from sheet
    const sheetMemberIds: string[] = [];
    rowsFromSource.forEach((row: Record<string, unknown>) => {
      const memberId = toStringValue(pickValue(row, ['member_id', 'memberid']));
      if (memberId) sheetMemberIds.push(memberId);
    });

    // Check for duplicates within the sheet
    const sheetDuplicates = validateUniqueMemberIds(rowsFromSource);
    if (!sheetDuplicates.valid) {
      const errorDetails = sheetDuplicates.duplicates
        .map(d => `MemberId "${d.memberId}" found in rows: ${d.rowIndices.join(', ')}`)
        .join('; ');
      
      await updateBatchProgress(batchId, {
        status: 'failed',
        endedAt: new Date(),
      });
      
      throw new AppError(
        StatusCodes.BAD_REQUEST,
        `Duplicate MemberIDs in sheet - import aborted: ${errorDetails}`
      );
    }

    // Check for existing memberIds in database for this branch
    const uniqueSheetIds = [...new Set(sheetMemberIds)];
    if (uniqueSheetIds.length > 0) {
      const existingMembers = await MemberRepository.findMany(
        { 
          branchId: batch.branchId, 
          memberId: { $in: uniqueSheetIds } 
        },
        { select: { memberId: 1 } }
      ).lean();
      
      if (existingMembers.length > 0) {
        const existingIds = existingMembers.map((m: any) => m.memberId).join(', ');
        
        await updateBatchProgress(batchId, {
          status: 'failed',
          endedAt: new Date(),
        });
        
        throw new AppError(
          StatusCodes.BAD_REQUEST,
          `MemberIDs already exist in branch - import aborted: ${existingIds}`
        );
      }
    }

    let processedRows = batch.processedRows || 0;
    let successRows = batch.successRows || 0;
    let failedRows = batch.failedRows || 0;
    let warningRows = batch.warningRows || 0;
    let cursor = batch.cursor || 0;

    const failuresPreview = (batch.failuresPreview || []).slice(0, runtimeConfig.maxPreviewRows);
    const warningsPreview = (batch.warningsPreview || []).slice(0, runtimeConfig.maxPreviewRows);
    const failedRowsData = (batch.failedRowsData || []).slice(0, runtimeConfig.maxFailedRowsData);

    await updateBatchProgress(batchId, {
      totalRows: rowsFromSource.length,
    });

    for (let index = cursor; index < rowsFromSource.length; index += runtimeConfig.chunkSize) {
      const currentBatch = await MemberImportBatchRepository.findById(batchId);

      if (!currentBatch) {
        throw new AppError(StatusCodes.NOT_FOUND, "Import batch not found");
      }

      if (currentBatch.cancelRequested) {
        await updateBatchProgress(batchId, {
          status: "cancelled",
          processedRows,
          successRows,
          failedRows,
          warningRows,
          cursor,
          failuresPreview,
          warningsPreview,
          failedRowsData,
          endedAt: new Date(),
        });
        return;
      }

      const chunk = rowsFromSource.slice(index, index + runtimeConfig.chunkSize);

      for (let chunkOffset = 0; chunkOffset < chunk.length; chunkOffset += 1) {
        const absoluteIndex = index + chunkOffset;
        const raw = chunk[chunkOffset] || {};
        const providedRowIndex = toNumberValue(raw.__row_index);
        const rowIndex = providedRowIndex && providedRowIndex > 0
          ? Math.floor(providedRowIndex)
          : absoluteIndex + 2;

        const rowResult = await processRow(
          String(batch.branchId),
          batchId,
          rowIndex,
          raw,
          branchMonthlyFee,
        );

        processedRows += 1;
        cursor = absoluteIndex + 1;

        if (rowResult.type === "failed") {
          failedRows += 1;

          if (rowResult.failure && failuresPreview.length < runtimeConfig.maxPreviewRows) {
            failuresPreview.push(rowResult.failure);
          }

          if (rowResult.failure && failedRowsData.length < runtimeConfig.maxFailedRowsData) {
            failedRowsData.push(rowResult.failure);
          }

          continue;
        }

        successRows += 1;

        if (rowResult.warning) {
          warningRows += 1;

          if (warningsPreview.length < runtimeConfig.maxPreviewRows) {
            warningsPreview.push(rowResult.warning);
          }
        }
      }

      await updateBatchProgress(batchId, {
        processedRows,
        successRows,
        failedRows,
        warningRows,
        cursor,
        failuresPreview,
        warningsPreview,
        failedRowsData,
      });

      await waitForEventLoopTurn();
    }

    const finalStatus: TMemberImportStatus =
      failedRows > 0 || warningRows > 0 ? "partial_failed" : "completed";

    await updateBatchProgress(batchId, {
      status: finalStatus,
      processedRows,
      successRows,
      failedRows,
      warningRows,
      cursor,
      failuresPreview,
      warningsPreview,
      failedRowsData,
      endedAt: new Date(),
    });
  } catch (error) {
    await updateBatchProgress(batchId, {
      status: "failed",
      endedAt: new Date(),
    });

    errorLogger.error("Member import batch failed", {
      batchId,
      branchId: String(batch.branchId),
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  } finally {
    activeBranchImports.delete(branchKey);
    queuedBatchIds.delete(batchId);
  }
};

const processQueue = async () => {
  if (queueRunning) {
    return;
  }

  queueRunning = true;

  while (importQueue.length > 0) {
    const batchId = importQueue.shift();

    if (!batchId) {
      continue;
    }

    await processBatch(batchId);
  }

  queueRunning = false;
};

const getActorInfo = (actor: TImportActor) => ({
  // Staff type in this codebase doesn't expose _id in interface, but Mongoose docs include it at runtime.
  // This cast keeps compile-time strictness while preserving runtime behavior.
  createdByStaffId: (actor.staff as (TStaff & { _id?: Types.ObjectId }) | undefined)?._id,
  createdByUserId: actor.userId,
});

const startGoogleSheetImport = async (
  branchId: string,
  actor: TImportActor,
  payload: TStartGoogleSheetImportPayload,
) => {
  await resolveBranchAccess(branchId, actor);
  ensureGoogleSheetsConfig();

  const branchObjectId = new Types.ObjectId(branchId);

  const pendingBatch = await MemberImportBatchRepository.findOne({
    branchId: branchObjectId,
    status: { $in: ["pending", "processing"] },
    cancelRequested: false,
  });

  if (pendingBatch || activeBranchImports.has(branchId)) {
    throw new AppError(
      StatusCodes.CONFLICT,
      "Another import is already running for this branch",
    );
  }

  const range = payload.range?.trim() || config.google.default_range || "Sheet1!A1:ZZ";

  const batch = await MemberImportBatchRepository.create({
    branchId: branchObjectId,
    source: "google_sheet",
    spreadsheetId: payload.spreadsheetId.trim(),
    range,
    status: "pending",
    cancelRequested: false,
    totalRows: 0,
    processedRows: 0,
    successRows: 0,
    failedRows: 0,
    warningRows: 0,
    cursor: 0,
    failuresPreview: [],
    warningsPreview: [],
    failedRowsData: [],
    retryRows: [],
    metadata: {
      requestedAt: new Date().toISOString(),
    },
    ...getActorInfo(actor),
  } as TMemberImportBatch);

  enqueueBatch(String(batch._id));
  void processQueue();

  logger.info("Member import batch queued", {
    batchId: String(batch._id),
    branchId,
    source: "google_sheet",
  });

  return batch;
};

const startCSVImport = async (
  branchId: string,
  actor: TImportActor,
  csvFile: Express.Multer.File,
) => {
  await resolveBranchAccess(branchId, actor);

  const branchObjectId = new Types.ObjectId(branchId);

  const pendingBatch = await MemberImportBatchRepository.findOne({
    branchId: branchObjectId,
    status: { $in: ["pending", "processing"] },
    cancelRequested: false,
  });

  if (pendingBatch || activeBranchImports.has(branchId)) {
    throw new AppError(
      StatusCodes.CONFLICT,
      "Another import is already running for this branch",
    );
  }

  // Parse CSV file content
  let csvRows: TRawImportRow[];
  try {
    const csvContent = csvFile.buffer.toString("utf-8");
    csvRows = parseCSVContent(csvContent);
  } catch (error) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Failed to parse CSV file");
  }

  if (csvRows.length === 0) {
    throw new AppError(StatusCodes.BAD_REQUEST, "CSV file is empty or has no valid data rows");
  }

  // Create batch record with CSV source
  const batch = await MemberImportBatchRepository.create({
    branchId: branchObjectId,
    source: "csv_upload",
    fileName: csvFile.originalname,
    status: "pending",
    cancelRequested: false,
    totalRows: 0,
    processedRows: 0,
    successRows: 0,
    failedRows: 0,
    warningRows: 0,
    cursor: 0,
    failuresPreview: [],
    warningsPreview: [],
    failedRowsData: [],
    retryRows: [],
    metadata: {
      requestedAt: new Date().toISOString(),
      csvRowCount: csvRows.length,
    },
    ...getActorInfo(actor),
  } as TMemberImportBatch);

  // Store CSV rows in memory for processing
  // We'll process them using the same logic as Google Sheets
  await MemberImportBatchRepository.updateById(String(batch._id), {
    csvData: csvRows,
  } as any);

  enqueueBatch(String(batch._id));
  void processQueue();

  logger.info("CSV import batch queued", {
    batchId: String(batch._id),
    branchId,
    fileName: csvFile.originalname,
    rowCount: csvRows.length,
  });

  return batch;
};

const getImportBatchById = async (
  branchId: string,
  batchId: string,
  actor: TImportActor,
) => {
  await resolveBranchAccess(branchId, actor);

  const batch = await MemberImportBatchRepository.findOne({
    _id: new Types.ObjectId(batchId),
    branchId: new Types.ObjectId(branchId),
  });

  if (!batch) {
    throw new AppError(StatusCodes.NOT_FOUND, "Import batch not found");
  }

  return batch;
};

const listImportBatches = async (
  branchId: string,
  actor: TImportActor,
  query: TListImportBatchQuery,
) => {
  await resolveBranchAccess(branchId, actor);

  const pageRaw = toNumberValue(query.page);
  const limitRaw = toNumberValue(query.limit);
  const page = pageRaw && pageRaw > 0 ? Math.floor(pageRaw) : 1;
  const limit = limitRaw && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 100) : 20;

  const statusRaw = toStringValue(query.status) as TMemberImportStatus | undefined;
  if (statusRaw && !IMPORT_STATUS_SET.has(statusRaw)) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Invalid import status filter");
  }

  const filter: Record<string, unknown> = {
    branchId: new Types.ObjectId(branchId),
  };

  if (statusRaw) {
    filter.status = statusRaw;
  }

  const [data, total] = await Promise.all([
    MemberImportBatchRepository.findMany(filter, {
      sort: { createdAt: -1 },
      skip: (page - 1) * limit,
      limit,
    }).lean(),
    MemberImportBatchRepository.count(filter),
  ]);

  return {
    meta: {
      page,
      limit,
      total,
      totalPage: Math.ceil(total / limit),
    },
    data,
  };
};

const getImportMetrics = async (
  branchId: string,
  actor: TImportActor,
  query: TImportMetricsQuery,
) => {
  await resolveBranchAccess(branchId, actor);

  const daysRaw = toNumberValue(query.days);
  const days = daysRaw && daysRaw > 0 ? Math.min(Math.floor(daysRaw), 90) : 7;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const branchObjectId = new Types.ObjectId(branchId);

  const matchFilter = {
    branchId: branchObjectId,
    createdAt: { $gte: since },
  };

  const [summaryRows, statusRows, recentBatches, branchPendingCount] = await Promise.all([
    MemberImportBatchRepository.aggregate([
      {
        $match: matchFilter,
      },
      {
        $group: {
          _id: null,
          totalBatches: { $sum: 1 },
          totalRows: { $sum: { $ifNull: ["$totalRows", 0] } },
          processedRows: { $sum: { $ifNull: ["$processedRows", 0] } },
          successRows: { $sum: { $ifNull: ["$successRows", 0] } },
          failedRows: { $sum: { $ifNull: ["$failedRows", 0] } },
          warningRows: { $sum: { $ifNull: ["$warningRows", 0] } },
          completedDurationMsSum: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ["$startedAt", null] },
                    { $ne: ["$endedAt", null] },
                  ],
                },
                { $subtract: ["$endedAt", "$startedAt"] },
                0,
              ],
            },
          },
          completedDurationCount: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ["$startedAt", null] },
                    { $ne: ["$endedAt", null] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ]),
    MemberImportBatchRepository.aggregate([
      {
        $match: matchFilter,
      },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
    ]),
    MemberImportBatchRepository.findMany(matchFilter, {
      sort: { createdAt: -1 },
      limit: 5,
      select: {
        status: 1,
        createdAt: 1,
        startedAt: 1,
        endedAt: 1,
        totalRows: 1,
        processedRows: 1,
        successRows: 1,
        failedRows: 1,
        warningRows: 1,
      },
    }).lean(),
    MemberImportBatchRepository.count({
      branchId: branchObjectId,
      status: "pending",
      cancelRequested: false,
    }),
  ]);

  const safeNumber = (value: unknown) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const summary = (summaryRows[0] || {}) as Record<string, unknown>;

  const statusCounts: Record<TMemberImportStatus, number> = {
    pending: 0,
    processing: 0,
    completed: 0,
    partial_failed: 0,
    failed: 0,
    cancelled: 0,
  };

  statusRows.forEach((row) => {
    const rowRecord = row as Record<string, unknown>;
    const status = toStringValue(rowRecord._id) as TMemberImportStatus | undefined;

    if (status && IMPORT_STATUS_SET.has(status)) {
      statusCounts[status] = safeNumber(rowRecord.count);
    }
  });

  const durationCount = safeNumber(summary.completedDurationCount);
  const durationSum = safeNumber(summary.completedDurationMsSum);
  const averageDurationMs = durationCount > 0 ? Math.round(durationSum / durationCount) : 0;

  const processedRows = safeNumber(summary.processedRows);
  const successRows = safeNumber(summary.successRows);
  const successRate = processedRows > 0
    ? Number(((successRows / processedRows) * 100).toFixed(2))
    : 0;

  return {
    windowDays: days,
    since,
    statusCounts,
    summary: {
      totalBatches: safeNumber(summary.totalBatches),
      totalRows: safeNumber(summary.totalRows),
      processedRows,
      successRows,
      failedRows: safeNumber(summary.failedRows),
      warningRows: safeNumber(summary.warningRows),
      successRate,
      averageDurationMs,
    },
    runtime: {
      queueRunning,
      totalQueued: importQueue.length,
      branchActive: activeBranchImports.has(branchId),
      branchPendingCount,
    },
    recentBatches,
  };
};

const requestCancelImport = async (
  branchId: string,
  batchId: string,
  actor: TImportActor,
) => {
  const batch = await getImportBatchById(branchId, batchId, actor);

  if (["completed", "failed", "cancelled"].includes(batch.status)) {
    return batch;
  }

  const updated = await MemberImportBatchRepository.updateById(batchId, {
    cancelRequested: true,
  });

  if (!updated) {
    throw new AppError(StatusCodes.NOT_FOUND, "Import batch not found");
  }

  if (updated.status === "pending") {
    removeBatchFromQueue(batchId);

    const cancelled = await MemberImportBatchRepository.updateById(batchId, {
      status: "cancelled",
      endedAt: new Date(),
    });

    if (!cancelled) {
      throw new AppError(StatusCodes.NOT_FOUND, "Import batch not found");
    }

    return cancelled;
  }

  return updated;
};

const retryFailedRows = async (
  branchId: string,
  batchId: string,
  actor: TImportActor,
) => {
  const batch = await getImportBatchById(branchId, batchId, actor);

  if (["pending", "processing"].includes(batch.status)) {
    throw new AppError(
      StatusCodes.CONFLICT,
      "Cannot retry while import batch is running",
    );
  }

  const failedRowsData = batch.failedRowsData || [];

  if (failedRowsData.length === 0) {
    throw new AppError(StatusCodes.BAD_REQUEST, "No failed rows available for retry");
  }

  const pendingBatch = await MemberImportBatchRepository.findOne({
    branchId: new Types.ObjectId(branchId),
    status: { $in: ["pending", "processing"] },
    cancelRequested: false,
  });

  if (pendingBatch || activeBranchImports.has(branchId)) {
    throw new AppError(
      StatusCodes.CONFLICT,
      "Another import is already running for this branch",
    );
  }

  const retryRows = failedRowsData
    .map((entry) => {
      if (!entry.raw) {
        return null;
      }

      return {
        ...entry.raw,
        __row_index: entry.rowIndex,
      };
    })
    .filter(Boolean) as Record<string, unknown>[];

  if (retryRows.length === 0) {
    throw new AppError(StatusCodes.BAD_REQUEST, "No retryable failed rows found");
  }

  const retryBatch = await MemberImportBatchRepository.create({
    branchId: new Types.ObjectId(branchId),
    source: "google_sheet",
    spreadsheetId: batch.spreadsheetId,
    range: batch.range,
    status: "pending",
    retryOfBatchId: batch._id as Types.ObjectId,
    cancelRequested: false,
    totalRows: retryRows.length,
    processedRows: 0,
    successRows: 0,
    failedRows: 0,
    warningRows: 0,
    cursor: 0,
    failuresPreview: [],
    warningsPreview: [],
    failedRowsData: [],
    retryRows,
    metadata: {
      requestedAt: new Date().toISOString(),
      retryOfBatchId: String(batch._id),
    },
    ...getActorInfo(actor),
  } as TMemberImportBatch);

  enqueueBatch(String(retryBatch._id));
  void processQueue();

  logger.info("Member import retry batch queued", {
    batchId: String(retryBatch._id),
    retryOfBatchId: batchId,
    branchId,
  });

  return retryBatch;
};

const resumePendingBatches = async () => {
  const pendingBatches = await MemberImportBatchRepository.findMany(
    {
      status: { $in: ["pending", "processing"] },
      cancelRequested: false,
    },
    {
      sort: { createdAt: 1 },
      limit: 25,
    },
  );

  if (pendingBatches.length === 0) {
    return;
  }

  pendingBatches.forEach((batch) => {
    enqueueBatch(String(batch._id));
  });

  void processQueue();

  logger.info("Recovered pending member import batches", {
    count: pendingBatches.length,
  });
};

export const MemberImportService = {
  startGoogleSheetImport,
  startCSVImport,
  listImportBatches,
  getImportMetrics,
  getImportBatchById,
  requestCancelImport,
  retryFailedRows,
  resumePendingBatches,
};
