import path from "path";
import * as XLSX from "xlsx";
import { google } from "googleapis";
import { StatusCodes } from "http-status-codes";
import { Types } from "mongoose";

import config from "../../config";
import AppError from "../../errors/AppError";
import { errorLogger, logger } from "../../logger/logger";
import cacheService from "../../redis-client/cacheService";
import { BranchRepository } from "../branch/branch.repository";
import { BusinessProfileRepository } from "../businessProfile/businessProfile.repository";
import {
  reconcileRecurringBillingBalance,
} from "../payment/payment.balance";
import {
  PaymentMethod,
  PaymentStatus,
  PaymentType,
  TPayment,
} from "../payment/payment.interface";
import { PaymentRepository } from "../payment/payment.repository";
import { InvoiceCounterService } from "../payment/invoiceCounter.service";
import { TStaff } from "../staff/staff.interface";
import { TMember } from "./member.interface";
import {
  createAdmissionDueLedgerItem,
  mergeMemberBillingLedgerMetadata,
} from "./member.billingLedger";
import { MemberCounterService } from "./memberCounter.service";
import { Member } from "./member.model";
import {
  TMemberImportBatch,
  TMemberImportFailureRow,
  TMemberImportStatus,
} from "./memberImportBatch.interface";
import { MemberImportBatchRepository } from "./memberImportBatch.repository";
import { MemberRepository } from "./member.repository";
import { InvoiceCounter } from "../payment/invoiceCounter.model";
import { Payment } from "../payment/payment.model";

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

type TImportRuntimeConfig = {
  chunkSize: number;
  maxPreviewRows: number;
  maxFailedRowsData: number;
  maxRowsPerBatch: number;
};

type TMemberImportIdentifier = {
  memberId?: string;
  barcode?: string;
  email?: string;
  contact?: string;
  fullName: string;
};

type TMemberConflictDetails = {
  fieldLabel: string;
  value: string;
  message?: string;
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
    .replace(/^\uFEFF/, "")
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

const MONTH_ABBRS = [
  'jan', 'feb', 'mar', 'apr', 'may', 'jun',
  'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
];

const MONTH_ABBRS_OUTPUT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const resolveMonthIndex = (monthStr: string): number => {
  return MONTH_ABBRS.indexOf(monthStr.toLowerCase());
};

const parseNextPaymentDateText = (value: unknown): Date | undefined => {
  if (value == null) return undefined;

  const str = String(value).trim();
  if (!str) return undefined;

  // "DD-Mon-YY" or "DD-Mon-YYYY" — e.g. "01-May-26", "31-Jan-2026"
  const ddMonYearMatch = str.match(/^(\d{2})-([A-Za-z]{3})-(\d{2,4})$/);
  if (ddMonYearMatch) {
    const day = parseInt(ddMonYearMatch[1]!, 10);
    const monthIndex = resolveMonthIndex(ddMonYearMatch[2]!);
    let year = parseInt(ddMonYearMatch[3]!, 10);
    if (year < 100) year += 2000;

    if (monthIndex >= 0 && day >= 1 && day <= 31 && year >= 1970 && year <= 2100) {
      const result = new Date(year, monthIndex, day);
      if (result.getDate() === day) return result;
    }
    return undefined;
  }

  // "Mon-YY" or "Mon-YYYY" — e.g. "May-26", "Jan-2026"
  const monYearMatch = str.match(/^([A-Za-z]{3})-(\d{2,4})$/);
  if (monYearMatch) {
    const monthIndex = resolveMonthIndex(monYearMatch[1]!);
    let year = parseInt(monYearMatch[2]!, 10);
    if (year < 100) year += 2000;

    if (monthIndex >= 0 && year >= 1970 && year <= 2100) {
      return new Date(year, monthIndex, 1);
    }
    return undefined;
  }

  return undefined;
};

export const formatNextPaymentDate = (date: Date): string => {
  const day = String(date.getDate()).padStart(2, '0');
  const month = MONTH_ABBRS_OUTPUT[date.getMonth()];
  const year = date.getFullYear();
  return `${day}-${month}-${year}`;
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

const validateUniquePhones = (
  rows: TRawImportRow[]
): { valid: boolean; duplicates: { phone: string; rowIndices: number[] }[] } => {
  const phoneMap = new Map<string, number[]>();

  rows.forEach((row, index) => {
    const phone = toStringValue(pickValue(row, ["contact", "phone", "mobile", "phone_number"]));
    if (phone) {
      const existing = phoneMap.get(phone) || [];
      existing.push(index + 2); // +2 for header row offset
      phoneMap.set(phone, existing);
    }
  });

  const duplicates: { phone: string; rowIndices: number[] }[] = [];
  phoneMap.forEach((indices, phone) => {
    if (indices.length > 1) {
      duplicates.push({ phone, rowIndices: indices });
    }
  });

  return { valid: duplicates.length === 0, duplicates };
};

const calculateBalanceSnapshot = (
  nextPaymentDate: Date | undefined,
  monthlyFee: number,
  sheetDueAmount: number,
  isActive: boolean
): {
  currentDueAmount: number;
  updatedNextPaymentDate: Date | undefined;
  overdueMonths: number;
  accruedAmount: number;
} => {
  const snapshot = reconcileRecurringBillingBalance({
    nextPaymentDate,
    recurringChargeAmount: monthlyFee,
    openingNetBalance: sheetDueAmount,
    isActive,
  });

  return {
    currentDueAmount: snapshot.currentDueAmount,
    updatedNextPaymentDate: snapshot.updatedNextPaymentDate || nextPaymentDate,
    overdueMonths: snapshot.overdueMonths,
    accruedAmount: snapshot.accruedAmount,
  };
};

// ── Pure validation — no DB writes ──
type TParsedRow = {
  fullName: string;
  contact: string | undefined;
  email: string | undefined;
  memberId: string | undefined;
  monthlyFeeAmount: number;
  sheetDueAmount: number;
  isActive: boolean;
  nextPaymentDate: Date | undefined;
  updatedNextPaymentDate: Date | undefined;
  currentDueAmount: number;
};

type TValidateRowResult =
  | { valid: true; parsed: TParsedRow }
  | { valid: false; failure: TMemberImportFailureRow };

const validateRow = (
  rowIndex: number,
  row: TRawImportRow,
  branchMonthlyFee: number,
): TValidateRowResult => {
  const fullName = toStringValue(pickValue(row, ["full_name", "fullname", "name", "member_name"]));
  if (!fullName) {
    return { valid: false, failure: { rowIndex, reason: "Name is required", raw: row } };
  }

  const contact = toStringValue(pickValue(row, ["contact", "phone", "mobile", "phone_number"]));
  const email = toStringValue(pickValue(row, ["email", "mail"]))?.toLowerCase();
  if (!contact && !email) {
    return { valid: false, failure: { rowIndex, reason: "Phone number or email is required", raw: row } };
  }

  const memberId = toStringValue(pickValue(row, ["member_id", "memberid"]));

  const sheetMonthlyFee = toNumberValue(pickValue(row, ["monthly_fee", "monthly_fee_amount", "monthlyamount"]));
  const monthlyFeeAmount = sheetMonthlyFee ?? branchMonthlyFee;
  if (!monthlyFeeAmount || monthlyFeeAmount <= 0) {
    return { valid: false, failure: { rowIndex, reason: "Monthly fee is required (not in sheet or branch settings)", raw: row } };
  }

  const sheetDueAmount = toNumberValue(pickValue(row, ["due_amount", "due", "dueamount"])) || 0;

  const statusRaw = toStringValue(pickValue(row, ["status", "member_status"]));
  const isActive = statusRaw?.toLowerCase() !== "inactive";

  const nextPaymentDateRaw = pickValue(row, [
    "next_payment_date", "next_payment", "nextpaymentdate",
    "payment_date", "next_pamyent_date", "nextpamyentdate",
  ]);
  const nextPaymentDate = parseNextPaymentDateText(nextPaymentDateRaw);
  if (!nextPaymentDate && isActive) {
    return { valid: false, failure: { rowIndex, reason: `Next payment date is required for active members (received: ${JSON.stringify(nextPaymentDateRaw)})`, raw: row } };
  }

  const { currentDueAmount, updatedNextPaymentDate } = calculateBalanceSnapshot(nextPaymentDate, monthlyFeeAmount, sheetDueAmount, isActive);

  return {
    valid: true,
    parsed: { fullName, contact, email, memberId, monthlyFeeAmount, sheetDueAmount, isActive, nextPaymentDate, updatedNextPaymentDate, currentDueAmount },
  };
};

// ── Batch DB conflict check — single query for all contacts/emails ──
type TDBConflictFailure = {
  rowIndex: number;
  reason: string;
  memberName?: string;
  raw?: Record<string, unknown>;
};

const batchCheckDBConflicts = async (
  branchObjectId: Types.ObjectId,
  validatedRows: { rowIndex: number; parsed: TParsedRow; raw: TRawImportRow }[],
): Promise<TDBConflictFailure[]> => {
  const allContacts = validatedRows
    .map((r) => r.parsed.contact)
    .filter((c): c is string => !!c);
  const allEmails = validatedRows
    .map((r) => r.parsed.email)
    .filter((e): e is string => !!e);

  if (allContacts.length === 0 && allEmails.length === 0) return [];

  const $or: Record<string, unknown>[] = [];
  if (allContacts.length > 0) $or.push({ contact: { $in: allContacts } });
  if (allEmails.length > 0) $or.push({ email: { $in: allEmails } });

  const existingMembers = await MemberRepository.findMany({
    branchId: branchObjectId,
    $or,
  }, { select: "contact email fullName systemMemberId" });

  if (existingMembers.length === 0) return [];

  // Build lookup maps for fast matching
  const contactMap = new Map<string, typeof existingMembers[0]>();
  const emailMap = new Map<string, typeof existingMembers[0]>();
  for (const member of existingMembers) {
    if (member.contact) contactMap.set(member.contact, member);
    if (member.email) emailMap.set(member.email, member);
  }

  const failures: TDBConflictFailure[] = [];

  for (const { rowIndex, parsed, raw } of validatedRows) {
    if (parsed.contact && contactMap.has(parsed.contact)) {
      const existing = contactMap.get(parsed.contact)!;
      const sysId = (existing as unknown as Record<string, unknown>).systemMemberId;
      failures.push({
        rowIndex,
        reason: `Phone '${parsed.contact}' is already registered to member '${existing.fullName}'${sysId != null ? ` (System ID: #${sysId})` : ""}.`,
        memberName: parsed.fullName,
        raw,
      });
    } else if (parsed.email && emailMap.has(parsed.email)) {
      const existing = emailMap.get(parsed.email)!;
      failures.push({
        rowIndex,
        reason: `Email '${parsed.email}' is already registered to member '${existing.fullName}'.`,
        memberName: parsed.fullName,
        raw,
      });
    }
  }

  return failures;
};

export const ensureOpeningImportPayment = async ({
  branchId,
  batchId,
  source,
  rowIndex,
  member,
  monthlyFeeAmount,
  sheetDueAmount,
  originalNextPaymentDate,
}: {
  branchId: Types.ObjectId;
  batchId: string;
  source: TMemberImportBatch["source"];
  rowIndex: number;
  member: TMember & { _id?: unknown };
  monthlyFeeAmount: number;
  sheetDueAmount: number;
  originalNextPaymentDate: Date | undefined;
}) => {
  if (!member._id) {
    return;
  }

  const existingOpeningEntry = await PaymentRepository.findOne({
    branchId,
    importBatchId: batchId,
    memberId: member._id,
    "metadata.entryKind": "opening_import_balance",
  });

  if (existingOpeningEntry) {
    return;
  }

  const paymentData: TPayment = {
    branchId,
    invoiceNo: `PAY-${String(await InvoiceCounterService.getNextInvoiceSequence("PAYMENT")).padStart(12, "0")}`,
    memberId: member._id as Types.ObjectId,
    memberName: member.fullName,
    paymentType: PaymentType.OTHER,
    subTotal: 0,
    discount: 0,
    dueAmount: member.currentDueAmount ?? 0,
    paidTotal: 0,
    paymentMethod: PaymentMethod.Other,
    paymentDate: new Date(),
    nextPaymentDate: member.nextPaymentDate,
    status:
      (member.currentDueAmount ?? 0) > 0 ? PaymentStatus.DUE : PaymentStatus.PAID,
    source,
    importBatchId: batchId,
    metadata: {
      entryKind: "opening_import_balance",
      importRowIndex: rowIndex,
      originalNextPaymentDate: originalNextPaymentDate?.toISOString() ?? null,
      openingDueAmount: member.currentDueAmount ?? 0,
      sheetDueAmount,
      monthlyFeeAmount,
    },
  };

  await PaymentRepository.create(paymentData);
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

const PHONE_COLUMN_NAMES = new Set([
  "contact", "phone", "mobile", "phone_number", "phonenumber",
  "contact_number", "contactnumber", "emergency_contact",
]);

const normalizePhoneValue = (value: unknown): string | undefined => {
  if (value == null) return undefined;

  let str: string;
  if (typeof value === "number") {
    // Excel dropped leading zeros — pad back to 11 digits
    str = String(Math.round(value));
    if (str.length === 10 && str.startsWith("1")) {
      str = `0${str}`;
    }
  } else {
    str = String(value).trim();
  }

  return str || undefined;
};

const isXLSXFile = (filename: string): boolean => {
  return path.extname(filename).toLowerCase() === ".xlsx";
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
  row: TMemberImportIdentifier,
): Record<string, unknown> | null => {
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

const findExistingMemberConflict = async (
  branchObjectId: Types.ObjectId,
  row: TMemberImportIdentifier,
): Promise<TMemberConflictDetails | null> => {
  const filters: Record<string, unknown>[] = [];

  // memberId is NOT unique — duplicates are allowed — so never check it here.

  if (row.barcode) {
    filters.push({ barcode: row.barcode });
  }

  if (row.email) {
    filters.push({ email: row.email });
  }

  if (row.contact) {
    filters.push({ contact: row.contact });
  }

  if (filters.length === 0) {
    return null;
  }

  const existing = await MemberRepository.findOne({
    branchId: branchObjectId,
    $or: filters,
  });

  if (!existing) {
    return null;
  }

  if (row.barcode && existing.barcode === row.barcode) {
    return {
      fieldLabel: "barcode",
      value: row.barcode,
    };
  }

  if (row.email && existing.email === row.email) {
    return {
      fieldLabel: "email",
      value: row.email,
    };
  }

  if (row.contact && existing.contact === row.contact) {
    const sysId = (existing as TMember & { systemMemberId?: number }).systemMemberId;
    return {
      fieldLabel: "phone number",
      value: row.contact,
      message: `Phone '${row.contact}' is already registered to member '${existing.fullName}'${
        sysId != null ? ` (System ID: #${sysId})` : ""
      }.`,
    };
  }

  return {
    fieldLabel: "member details",
    value: row.fullName,
  };
};

const getDuplicateConflictMessage = (error: unknown): string | null => {
  const duplicateError = error as {
    code?: number;
    keyValue?: Record<string, unknown>;
  };

  if (duplicateError?.code !== 11000) {
    return null;
  }

  const [field, rawValue] = Object.entries(duplicateError.keyValue || {})[0] || [];

  if (!field) {
    return "A member already exists with the same unique value";
  }

  const value = toStringValue(rawValue);

  if (field.includes("contact")) {
    return value
      ? `Phone '${value}' is already registered to another member in this branch.`
      : "A member with this phone number already exists in this branch.";
  }

  return value
    ? `A member already exists with the same ${field}: "${value}"`
    : `A member already exists with the same ${field}`;
};

export const persistMember = async (
  branchObjectId: Types.ObjectId,
  memberData: TMember,
  identifier: TMemberImportIdentifier,
  options: {
    allowUpdate: boolean;
  },
) => {
  if (!options.allowUpdate) {
    const conflict = await findExistingMemberConflict(branchObjectId, identifier);

    if (conflict) {
      throw new AppError(
        StatusCodes.CONFLICT,
        conflict.message || `A member already exists with the same ${conflict.fieldLabel}: "${conflict.value}"`,
      );
    }

    memberData.systemMemberId = await MemberCounterService.getNextSystemMemberId(branchObjectId);
    return MemberRepository.create(memberData);
  }

  const filter = buildMemberUpsertFilter(branchObjectId, identifier);

  if (!filter) {
    memberData.systemMemberId = await MemberCounterService.getNextSystemMemberId(branchObjectId);
    return MemberRepository.create(memberData);
  }

  const existing = await MemberRepository.findOne(filter);

  if (!existing) {
    memberData.systemMemberId = await MemberCounterService.getNextSystemMemberId(branchObjectId);
    return MemberRepository.create(memberData);
  }

  // Update: preserve existing systemMemberId — never overwrite
  const { systemMemberId: _ignored, ...updateData } = memberData as TMember & { systemMemberId?: number };
  const updated = await MemberRepository.updateById(String(existing._id), updateData as TMember);

  if (!updated) {
    throw new AppError(StatusCodes.INTERNAL_SERVER_ERROR, "Failed to update imported member");
  }

  return updated;
};

// processRow removed — replaced by batch operations in Phase 3

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
    errorMessage?: string | null;
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

    if (rowsFromSource.length === 0) {
      throw new AppError(
        StatusCodes.BAD_REQUEST,
        batch.source === "csv_upload"
          ? "No rows found in CSV file"
          : "No rows found in Google Sheet",
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

    // Collect all memberIds from sheet
    const sheetMemberIds: string[] = [];
    rowsFromSource.forEach((row: Record<string, unknown>) => {
      const memberId = toStringValue(pickValue(row, ['member_id', 'memberid']));
      if (memberId) sheetMemberIds.push(memberId);
    });

    // Safety-net duplicate check (should be caught at upload time for CSV imports)
    const sheetDuplicates = validateUniqueMemberIds(rowsFromSource);
    if (!sheetDuplicates.valid) {
      const details = sheetDuplicates.duplicates
        .map(d => `"${d.memberId}" (rows ${d.rowIndices.join(", ")})`)
        .join("; ");
      await updateBatchProgress(batchId, { status: "failed", endedAt: new Date() });
      throw new AppError(
        StatusCodes.BAD_REQUEST,
        `Duplicate Member IDs in sheet: ${details}`,
      );
    }

    // Pre-scan for duplicate phone numbers within this batch
    const phoneDuplicates = validateUniquePhones(rowsFromSource);
    if (!phoneDuplicates.valid) {
      const details = phoneDuplicates.duplicates
        .map(d => `"${d.phone}" (rows ${d.rowIndices.join(", ")})`)
        .join("; ");
      await updateBatchProgress(batchId, { status: "failed", endedAt: new Date() });
      throw new AppError(
        StatusCodes.BAD_REQUEST,
        `Duplicate phone numbers found in the import data: ${details}. Each phone number must be unique within a branch.`,
      );
    }

    let processedRows = batch.processedRows || 0;
    let successRows = batch.successRows || 0;
    let failedRows = batch.failedRows || 0;
    let warningRows = batch.warningRows || 0;
    let cursor = batch.cursor || 0;

    const failuresPreview: TMemberImportFailureRow[] = (batch.failuresPreview || []).slice(0, runtimeConfig.maxPreviewRows);
    const warningsPreview: TMemberImportFailureRow[] = (batch.warningsPreview || []).slice(0, runtimeConfig.maxPreviewRows);
    const failedRowsData: TMemberImportFailureRow[] = (batch.failedRowsData || []).slice(0, runtimeConfig.maxFailedRowsData);

    await updateBatchProgress(batchId, {
      totalRows: rowsFromSource.length,
    });

    // ════════════════════════════════════════════════════════════════
    // PHASE 1: Validate ALL rows (no DB writes) — all-or-nothing
    // ════════════════════════════════════════════════════════════════
    const branchObjectId = new Types.ObjectId(String(batch.branchId));
    const validationFailures: TMemberImportFailureRow[] = [];
    const validatedRows: { rowIndex: number; parsed: TParsedRow; raw: TRawImportRow }[] = [];

    for (let i = 0; i < rowsFromSource.length; i += 1) {
      const raw = rowsFromSource[i] || {};
      const providedRowIndex = toNumberValue(raw.__row_index);
      const rowIndex = providedRowIndex && providedRowIndex > 0
        ? Math.floor(providedRowIndex)
        : i + 2;

      const result = validateRow(rowIndex, raw, branchMonthlyFee);
      if (!result.valid) {
        validationFailures.push(result.failure);
      } else {
        validatedRows.push({ rowIndex, parsed: result.parsed, raw });
      }
    }

    if (validationFailures.length > 0) {
      await updateBatchProgress(batchId, {
        status: "failed",
        totalRows: rowsFromSource.length,
        processedRows: rowsFromSource.length,
        failedRows: validationFailures.length,
        failuresPreview: validationFailures.slice(0, runtimeConfig.maxPreviewRows),
        failedRowsData: validationFailures.slice(0, runtimeConfig.maxFailedRowsData),
        endedAt: new Date(),
      });
      return;
    }

    // ════════════════════════════════════════════════════════════════
    // PHASE 2: Batch DB conflict check — single query
    // ════════════════════════════════════════════════════════════════
    const dbConflicts = await batchCheckDBConflicts(branchObjectId, validatedRows);
    if (dbConflicts.length > 0) {
      const dbFailures: TMemberImportFailureRow[] = dbConflicts.map((c) => ({
        rowIndex: c.rowIndex,
        reason: c.reason,
        memberName: c.memberName,
        raw: c.raw,
      }));
      await updateBatchProgress(batchId, {
        status: "failed",
        totalRows: rowsFromSource.length,
        processedRows: rowsFromSource.length,
        failedRows: dbFailures.length,
        failuresPreview: dbFailures.slice(0, runtimeConfig.maxPreviewRows),
        failedRowsData: dbFailures.slice(0, runtimeConfig.maxFailedRowsData),
        endedAt: new Date(),
      });
      return;
    }

    // ════════════════════════════════════════════════════════════════
    // PHASE 3: Import ALL rows — batched DB operations
    // ════════════════════════════════════════════════════════════════

    // --- 3a. Pre-fetch existing members for upsert detection (Google Sheets) ---
    const allContacts = validatedRows
      .map((r) => r.parsed.contact)
      .filter((c): c is string => !!c);
    const allEmails = validatedRows
      .map((r) => r.parsed.email)
      .filter((e): e is string => !!e);

    const existingMemberLookup = new Map<
      string,
      { _id: Types.ObjectId; contact?: string; email?: string; systemMemberId?: number }
    >();

    if (allContacts.length > 0 || allEmails.length > 0) {
      const $or: Record<string, unknown>[] = [];
      if (allContacts.length > 0) $or.push({ contact: { $in: allContacts } });
      if (allEmails.length > 0) $or.push({ email: { $in: allEmails } });

      const existingMembers = await MemberRepository.findMany(
        { branchId: branchObjectId, $or },
        { select: "contact email systemMemberId" },
      );

      for (const m of existingMembers) {
        if (m.contact) existingMemberLookup.set(`c:${m.contact}`, m);
        if (m.email) existingMemberLookup.set(`e:${m.email}`, m);
      }
    }

    // --- 3b. Classify rows (create vs update) and count new members ---
    const isUpdateMode = batch.source !== "csv_upload";
    let newMemberCount = 0;

    type TRowAction = "create" | "update";
    const rowActions: TRowAction[] = validatedRows.map((vr) => {
      const existing =
        (vr.parsed.contact && existingMemberLookup.get(`c:${vr.parsed.contact}`)) ||
        (vr.parsed.email && existingMemberLookup.get(`e:${vr.parsed.email}`));
      if (existing && isUpdateMode) return "update";
      return "create";
    });

    for (const action of rowActions) {
      if (action === "create") newMemberCount += 1;
    }

    // --- 3c. Pre-allocate system member IDs for new members ---
    let nextSystemMemberId = 0;
    if (newMemberCount > 0) {
      const startAt = await MemberCounterService.reserveSystemMemberIdRange(
        branchObjectId,
        newMemberCount,
      );
      nextSystemMemberId = startAt + 1;
    }
    let createSeqCounter = nextSystemMemberId;

    // --- 3d. Pre-allocate invoice sequences for payments ---
    let nextInvoiceSeq = 0;
    if (validatedRows.length > 0) {
      const invoiceCounterDoc = await InvoiceCounter.findOneAndUpdate(
        { type: "PAYMENT" },
        { $inc: { lastSequence: validatedRows.length } },
        { upsert: true, returnDocument: "before" },
      );
      nextInvoiceSeq = (invoiceCounterDoc as any)?.lastSequence ?? 0;
    }
    let invoiceSeqCounter = nextInvoiceSeq;

    // --- 3e. Build all member documents in memory (no DB calls) ---
    const importNow = new Date();

    type TMemberEntry = {
      rowIndex: number;
      raw: TRawImportRow;
      memberData: TMember;
      action: TRowAction;
      existingMemberId?: Types.ObjectId;
      monthlyFeeAmount: number;
      sheetDueAmount: number;
      originalNextPaymentDate: Date | undefined;
    };

    const allEntries: TMemberEntry[] = [];

    for (let i = 0; i < validatedRows.length; i += 1) {
      const { rowIndex, parsed, raw } = validatedRows[i]!;
      const action = rowActions[i]!;

      const {
        fullName,
        contact,
        email,
        memberId,
        monthlyFeeAmount,
        sheetDueAmount,
        isActive,
        nextPaymentDate,
        updatedNextPaymentDate,
        currentDueAmount,
      } = parsed;

      const existing: { _id: Types.ObjectId; contact?: string; email?: string; systemMemberId?: number } | undefined =
        (contact ? existingMemberLookup.get(`c:${contact}`) : undefined) ||
        (email ? existingMemberLookup.get(`e:${email}`) : undefined);

      const baseImportMetadata: Record<string, unknown> = {
        importRowIndex: rowIndex,
        originalNextPaymentDate: nextPaymentDate?.toISOString() ?? null,
        sheetDueAmount,
      };

      const importMemberMetadata =
        currentDueAmount > 0
          ? mergeMemberBillingLedgerMetadata(baseImportMetadata, {
              version: 1,
              items: [createAdmissionDueLedgerItem(currentDueAmount, importNow)],
              updatedAt: importNow.toISOString(),
            })
          : baseImportMetadata;

      const isCustomFee = monthlyFeeAmount !== branchMonthlyFee;

      const memberData: TMember = {
        branchId: branchObjectId,
        memberId,
        fullName,
        contact,
        email,
        nextPaymentDate: updatedNextPaymentDate,
        currentDueAmount,
        isActive,
        source: batch.source,
        importBatchId: batchId,
        metadata: importMemberMetadata,
        ...(isCustomFee
          ? { isCustomMonthlyFee: true, customMonthlyFeeAmount: monthlyFeeAmount }
          : {}),
      };

      if (action === "create") {
        memberData.systemMemberId = createSeqCounter++;
      }

      allEntries.push({
        rowIndex,
        raw,
        memberData,
        action,
        existingMemberId: existing?._id,
        monthlyFeeAmount,
        sheetDueAmount,
        originalNextPaymentDate: nextPaymentDate,
      });
    }

    // --- 3f. Persist members and payments in chunks ---
    for (
      let chunkStart = cursor;
      chunkStart < allEntries.length;
      chunkStart += runtimeConfig.chunkSize
    ) {
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
          cursor: chunkStart,
          failuresPreview,
          warningsPreview,
          failedRowsData,
          endedAt: new Date(),
        });
        return;
      }

      const chunk = allEntries.slice(chunkStart, chunkStart + runtimeConfig.chunkSize);
      const chunkCreates = chunk.filter((e) => e.action === "create");
      const chunkUpdates = chunk.filter((e) => e.action === "update");

      const persistedEntries: { entry: TMemberEntry; memberId: Types.ObjectId }[] = [];

      // ── Bulk insert new members ──
      if (chunkCreates.length > 0) {
        const createDocs = chunkCreates.map((e) => e.memberData);

        try {
          const insertedDocs = await Member.insertMany(createDocs, { ordered: false });
          for (let j = 0; j < insertedDocs.length; j += 1) {
            persistedEntries.push({
              entry: chunkCreates[j]!,
              memberId: (insertedDocs[j] as any)._id as Types.ObjectId,
            });
          }
        } catch (error: unknown) {
          const bulkError = error as {
            name?: string;
            writeErrors?: Array<{ index: number; code?: number; errmsg?: string }>;
            result?: { insertedIds?: Map<number, Types.ObjectId> };
          };

          if (bulkError.name === "MongoBulkWriteError" && bulkError.writeErrors) {
            const failedIndices = new Set(bulkError.writeErrors.map((we) => we.index));

            const insertedIds = bulkError.result?.insertedIds;
            if (insertedIds) {
              insertedIds.forEach((_id: Types.ObjectId, idx: number) => {
                if (!failedIndices.has(idx)) {
                  persistedEntries.push({
                    entry: chunkCreates[idx]!,
                    memberId: _id,
                  });
                }
              });
            }

            for (const we of bulkError.writeErrors) {
              const entry = chunkCreates[we.index];
              if (!entry) continue;

              failedRows += 1;

              const duplicateMsg = getDuplicateConflictMessage({ code: we.code });
              const reason = duplicateMsg || we.errmsg || "Failed to create member";

              const failure: TMemberImportFailureRow = {
                rowIndex: entry.rowIndex,
                reason,
                memberName: entry.memberData.fullName,
                raw: entry.raw,
              };

              if (failuresPreview.length < runtimeConfig.maxPreviewRows) {
                failuresPreview.push(failure);
              }
              if (failedRowsData.length < runtimeConfig.maxFailedRowsData) {
                failedRowsData.push(failure);
              }
            }
          } else {
            throw error;
          }
        }
      }

      // ── Bulk update existing members ──
      if (chunkUpdates.length > 0) {
        const updateOps = chunkUpdates.map((e) => {
          const { systemMemberId: _ignored, ...updateData } =
            e.memberData as TMember & { systemMemberId?: number };
          return {
            updateOne: {
              filter: { _id: e.existingMemberId },
              update: { $set: updateData },
            },
          };
        });

        try {
          await Member.bulkWrite(updateOps, { ordered: false });
          for (const e of chunkUpdates) {
            persistedEntries.push({
              entry: e,
              memberId: e.existingMemberId!,
            });
          }
        } catch (error: unknown) {
          const bulkError = error as {
            name?: string;
            writeErrors?: Array<{ index: number; code?: number; errmsg?: string }>;
          };

          if (bulkError.name === "MongoBulkWriteError" && bulkError.writeErrors) {
            const failedIndices = new Set(bulkError.writeErrors.map((we) => we.index));

            for (let j = 0; j < chunkUpdates.length; j += 1) {
              if (failedIndices.has(j)) {
                const entry = chunkUpdates[j]!;
                failedRows += 1;

                const failure: TMemberImportFailureRow = {
                  rowIndex: entry.rowIndex,
                  reason: "Failed to update member",
                  memberName: entry.memberData.fullName,
                  raw: entry.raw,
                };

                if (failuresPreview.length < runtimeConfig.maxPreviewRows) {
                  failuresPreview.push(failure);
                }
                if (failedRowsData.length < runtimeConfig.maxFailedRowsData) {
                  failedRowsData.push(failure);
                }
              } else {
                persistedEntries.push({
                  entry: chunkUpdates[j]!,
                  memberId: chunkUpdates[j]!.existingMemberId!,
                });
              }
            }
          } else {
            throw error;
          }
        }
      }

      // ── Bulk persist opening import payments ──
      if (persistedEntries.length > 0) {
        const memberIds = persistedEntries.map((pe) => pe.memberId);

        const existingPayments = await PaymentRepository.findMany(
          {
            branchId: branchObjectId,
            importBatchId: batchId,
            memberId: { $in: memberIds },
            "metadata.entryKind": "opening_import_balance",
          },
          { select: "memberId" },
        );

        const existingPaymentMemberIds = new Set(
          existingPayments.map((p) => String((p as any).memberId)),
        );

        const paymentDocs: TPayment[] = [];

        for (const { entry, memberId } of persistedEntries) {
          if (existingPaymentMemberIds.has(String(memberId))) continue;

          const invoiceNo = `PAY-${String(++invoiceSeqCounter).padStart(12, "0")}`;

          paymentDocs.push({
            branchId: branchObjectId,
            invoiceNo,
            memberId: memberId as Types.ObjectId,
            memberName: entry.memberData.fullName,
            paymentType: PaymentType.OTHER,
            subTotal: 0,
            discount: 0,
            dueAmount: entry.memberData.currentDueAmount ?? 0,
            paidTotal: 0,
            paymentMethod: PaymentMethod.Other,
            paymentDate: new Date(),
            nextPaymentDate: entry.memberData.nextPaymentDate,
            status:
              (entry.memberData.currentDueAmount ?? 0) > 0
                ? PaymentStatus.DUE
                : PaymentStatus.PAID,
            source: batch.source,
            importBatchId: batchId,
            metadata: {
              entryKind: "opening_import_balance",
              importRowIndex: entry.rowIndex,
              originalNextPaymentDate:
                entry.originalNextPaymentDate?.toISOString() ?? null,
              openingDueAmount: entry.memberData.currentDueAmount ?? 0,
              sheetDueAmount: entry.sheetDueAmount,
              monthlyFeeAmount: entry.monthlyFeeAmount,
            },
          });
        }

        if (paymentDocs.length > 0) {
          try {
            await Payment.insertMany(paymentDocs, { ordered: false });
          } catch (error: unknown) {
            logger.warn("Failed to batch insert opening import payments", {
              batchId,
              count: paymentDocs.length,
              message: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }

      // ── Update progress counters ──
      processedRows += chunk.length;
      successRows += persistedEntries.length;
      cursor = Math.min(chunkStart + runtimeConfig.chunkSize, allEntries.length);

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

    if (successRows > 0) {
      try {
        await cacheService.invalidateByPattern(`members:${branchKey}:list:*`);
      } catch (error) {
        logger.warn("Failed to invalidate member list cache after import", {
          batchId,
          branchId: branchKey,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    try {
      await updateBatchProgress(batchId, {
        status: "failed",
        errorMessage,
        endedAt: new Date(),
      });
    } catch {
      // ignore — batch may have already been deleted or DB unavailable
    }

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

const processQueueMutex = { locked: false };

const processQueue = async () => {
  if (queueRunning || processQueueMutex.locked) {
    return;
  }

  processQueueMutex.locked = true;
  queueRunning = true;

  try {
    while (importQueue.length > 0) {
      const batchId = importQueue.shift();

      if (!batchId) {
        continue;
      }

      await processBatch(batchId);
    }
  } finally {
    queueRunning = false;
    processQueueMutex.locked = false;
  }
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

  // Parse CSV/XLSX file content from the in-memory buffer
  // (fileUploadHandler uses multer.memoryStorage() and uploads to MinIO,
  //  so csvFile.buffer has the content — csvFile.path is a MinIO object key, not a local path)
  let csvRows: TRawImportRow[];
  try {
    if (isXLSXFile(csvFile.originalname)) {
      const workbook = XLSX.read(csvFile.buffer, { type: "buffer" });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) {
        csvRows = [];
      } else {
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) {
          csvRows = [];
        } else {
          const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false });
          if (jsonData.length === 0) {
            csvRows = [];
          } else {
            csvRows = jsonData
              .map((row) => {
                const normalized: TRawImportRow = {};
                for (const [key, value] of Object.entries(row)) {
                  const normalizedKey = normalizeKey(String(key));
                  const finalKey = normalizedKey || `column_${Object.keys(normalized).length + 1}`;
                  if (PHONE_COLUMN_NAMES.has(finalKey)) {
                    normalized[finalKey] = normalizePhoneValue(value);
                  } else {
                    normalized[finalKey] = value;
                  }
                }
                return normalized;
              })
              .filter((row) => Object.values(row).some((value) => toStringValue(value) !== undefined));
          }
        }
      }
    } else {
      const csvContent = csvFile.buffer.toString("utf-8");
      csvRows = parseCSVContent(csvContent);
    }
  } catch (error) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Failed to parse file. Please check the file format.");
  }

  if (csvRows.length === 0) {
    throw new AppError(StatusCodes.BAD_REQUEST, "File is empty or has no valid data rows");
  }

  // Pre-validate: reject immediately if member_id values are not unique within the sheet
  const csvDuplicates = validateUniqueMemberIds(csvRows);
  if (!csvDuplicates.valid) {
    const details = csvDuplicates.duplicates
      .map(d => `"${d.memberId}" (rows ${d.rowIndices.join(", ")})`)
      .join("; ");
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      `Duplicate Member IDs found in your CSV: ${details}. Please fix the duplicate IDs and re-upload.`,
    );
  }

  // Pre-validate: reject immediately if phone numbers are not unique within the sheet
  const phoneDuplicates = validateUniquePhones(csvRows);
  if (!phoneDuplicates.valid) {
    const details = phoneDuplicates.duplicates
      .map(d => `"${d.phone}" (rows ${d.rowIndices.join(", ")})`)
      .join("; ");
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      `Duplicate phone numbers found in your CSV: ${details}. Each phone number must be unique within a branch. Please fix and re-upload.`,
    );
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
    source: batch.source,
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

const STALE_PROCESSING_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

const resumePendingBatches = async () => {
  // Reset stale "processing" batches that may have been left behind by a crash
  const staleProcessingBatches = await MemberImportBatchRepository.findMany(
    {
      status: "processing",
      startedAt: { $lt: new Date(Date.now() - STALE_PROCESSING_THRESHOLD_MS) },
      cancelRequested: false,
    },
  );

  if (staleProcessingBatches.length > 0) {
    await Promise.all(
      staleProcessingBatches.map((batch) =>
        MemberImportBatchRepository.updateById(String(batch._id), {
          status: "pending",
          startedAt: null,
        }).then(() => {
          logger.info("Reset stale processing import batch to pending", {
            batchId: String(batch._id),
          });
        })
      ),
    );
  }

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
