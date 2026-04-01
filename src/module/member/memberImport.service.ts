import { google } from "googleapis";
import { StatusCodes } from "http-status-codes";
import { Types } from "mongoose";

import config from "../../config";
import AppError from "../../errors/AppError";
import { errorLogger, logger } from "../../logger/logger";
import { BranchRepository } from "../branch/branch.repository";
import { BusinessProfileRepository } from "../businessProfile/businessProfile.repository";
import {
  PackageDurationType,
  TPackage,
} from "../package/package.interface";
import { PackageRepository } from "../package/package.repository";
import {
  PaymentMethod,
  PaymentStatus,
  PaymentType,
  TPayment,
} from "../payment/payment.interface";
import { PaymentRepository } from "../payment/payment.repository";
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

type TPackageSnapshot = {
  _id: Types.ObjectId;
  legacyId?: TPackage["legacyId"];
  title: TPackage["title"];
  duration: TPackage["duration"];
  durationType: TPackage["durationType"];
  amount: TPackage["amount"];
};

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

const PAYMENT_METHOD_MAP: Record<string, PaymentMethod> = {
  cash: PaymentMethod.CASH,
  card: PaymentMethod.CARD,
  bkash: PaymentMethod.Bkash,
  nagad: PaymentMethod.Nagad,
  rocket: PaymentMethod.Rocket,
  bank_transfer: PaymentMethod.BankTransfer,
  banktransfer: PaymentMethod.BankTransfer,
  other: PaymentMethod.Other,
};

const PAYMENT_STATUS_MAP: Record<string, PaymentStatus> = {
  pending: PaymentStatus.PENDING,
  paid: PaymentStatus.PAID,
  partial: PaymentStatus.PARTIAL,
  due: PaymentStatus.DUE,
  cancelled: PaymentStatus.CANCELLED,
  canceled: PaymentStatus.CANCELLED,
  refunded: PaymentStatus.REFUNDED,
};

const TRAINING_GOALS = new Set([
  "Yoga",
  "Cardio Endurance",
  "Bodybuilding",
  "Muscle Gain",
  "Flexibility & Mobility",
  "General Fitness",
  "Strength Training",
]);

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

const toBooleanValue = (value: unknown): boolean | undefined => {
  if (value == null) {
    return undefined;
  }

  if (typeof value === "boolean") {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();

  if (["true", "yes", "1", "active"].includes(normalized)) {
    return true;
  }

  if (["false", "no", "0", "inactive"].includes(normalized)) {
    return false;
  }

  return undefined;
};

const toDateValue = (value: unknown): Date | undefined => {
  if (value == null) {
    return undefined;
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

const pickValue = (row: TRawImportRow, keys: string[]): unknown => {
  for (const key of keys) {
    if (key in row) {
      return row[key];
    }
  }

  return undefined;
};

const parsePaymentMethod = (value: unknown): PaymentMethod | undefined => {
  const parsed = toStringValue(value);
  if (!parsed) {
    return undefined;
  }

  return PAYMENT_METHOD_MAP[normalizeKey(parsed)];
};

const parsePaymentStatus = (value: unknown): PaymentStatus | undefined => {
  const parsed = toStringValue(value);
  if (!parsed) {
    return undefined;
  }

  return PAYMENT_STATUS_MAP[normalizeKey(parsed)];
};

const parseTrainingGoals = (value: unknown): TMember["trainingGoals"] => {
  const parsed = toStringValue(value);

  if (!parsed) {
    return [];
  }

  return parsed
    .split(",")
    .map((item) => item.trim())
    .filter((item) => TRAINING_GOALS.has(item)) as TMember["trainingGoals"];
};

const addDuration = (
  date: Date,
  duration: number,
  durationType: PackageDurationType,
): Date => {
  const nextDate = new Date(date);

  switch (durationType) {
    case PackageDurationType.DAY:
      nextDate.setDate(nextDate.getDate() + duration);
      break;
    case PackageDurationType.WEEK:
      nextDate.setDate(nextDate.getDate() + duration * 7);
      break;
    case PackageDurationType.MONTH:
      nextDate.setMonth(nextDate.getMonth() + duration);
      break;
    case PackageDurationType.YEAR:
      nextDate.setFullYear(nextDate.getFullYear() + duration);
      break;
    case PackageDurationType.CUSTOM:
      nextDate.setDate(nextDate.getDate() + duration);
      break;
    default:
      nextDate.setMonth(nextDate.getMonth() + duration);
      break;
  }

  return nextDate;
};

const addMonths = (date: Date, months: number): Date => {
  const nextDate = new Date(date);
  nextDate.setMonth(nextDate.getMonth() + months);
  return nextDate;
};

const computePaymentStatus = (
  dueAmount: number,
  paidTotal: number,
  requestedStatus?: PaymentStatus,
): PaymentStatus => {
  if (requestedStatus) {
    return requestedStatus;
  }

  if (dueAmount <= 0) {
    return PaymentStatus.PAID;
  }

  if (paidTotal <= 0) {
    return PaymentStatus.DUE;
  }

  return PaymentStatus.PARTIAL;
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

const createPackageLookup = async (branchId: string) => {
  const packageDocs = (await PackageRepository.findMany(
    {
      branchId: new Types.ObjectId(branchId),
      isActive: true,
    },
    {
      select: {
        _id: 1,
        legacyId: 1,
        title: 1,
        duration: 1,
        durationType: 1,
        amount: 1,
      },
    },
  ).lean()) as (TPackageSnapshot & { _id: Types.ObjectId })[];

  const byId = new Map<string, TPackageSnapshot>();
  const byLegacy = new Map<string, TPackageSnapshot>();
  const byTitle = new Map<string, TPackageSnapshot>();

  packageDocs.forEach((item) => {
    byId.set(String(item._id), item);

    if (item.legacyId) {
      byLegacy.set(normalizeKey(item.legacyId), item);
    }

    byTitle.set(normalizeKey(item.title), item);
  });

  return {
    byId,
    byLegacy,
    byTitle,
  };
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

const persistPayment = async (
  paymentData: Omit<TPayment, "memberName">,
  memberName: string,
) => {
  const filter = {
    branchId: paymentData.branchId,
    memberId: paymentData.memberId,
    importBatchId: paymentData.importBatchId,
  };

  const existing = await PaymentRepository.findOne(filter);

  if (!existing) {
    return PaymentRepository.create({
      ...paymentData,
      memberName,
    } as TPayment);
  }

  const updated = await PaymentRepository.updateById(String(existing._id), {
    ...paymentData,
    memberName,
  });

  if (!updated) {
    throw new AppError(StatusCodes.INTERNAL_SERVER_ERROR, "Failed to update imported payment");
  }

  return updated;
};

const processRow = async (
  branchId: string,
  batchId: string,
  rowIndex: number,
  row: TRawImportRow,
  packageLookup: Awaited<ReturnType<typeof createPackageLookup>>,
): Promise<TProcessRowResult> => {
  const branchObjectId = new Types.ObjectId(branchId);

  const fullName = toStringValue(
    pickValue(row, ["full_name", "fullname", "name", "member_name"]),
  );

  if (!fullName) {
    return {
      type: "failed",
      failure: {
        rowIndex,
        reason: "fullName is required",
        raw: row,
      },
    };
  }

  const legacyId = toStringValue(pickValue(row, ["legacy_id", "legacyid"]));
  const memberId = toStringValue(pickValue(row, ["member_id", "memberid"]));
  const barcode = toStringValue(pickValue(row, ["barcode", "bar_code"]));
  const contact = toStringValue(
    pickValue(row, ["contact", "phone", "mobile", "phone_number"]),
  );
  const email = toStringValue(pickValue(row, ["email", "mail"]))?.toLowerCase();

  const packageIdInput = toStringValue(
    pickValue(row, ["package_id", "current_package_id", "packageid"]),
  );
  const packageLegacyInput = toStringValue(
    pickValue(row, ["package_legacy_id", "packagelegacyid"]),
  );
  const packageNameInput = toStringValue(
    pickValue(row, ["package_name", "package", "package_title"]),
  );

  let selectedPackage: TPackageSnapshot | undefined;

  if (packageIdInput) {
    selectedPackage = packageLookup.byId.get(packageIdInput);
  }

  if (!selectedPackage && packageLegacyInput) {
    selectedPackage = packageLookup.byLegacy.get(normalizeKey(packageLegacyInput));
  }

  if (!selectedPackage && packageNameInput) {
    selectedPackage = packageLookup.byTitle.get(normalizeKey(packageNameInput));
  }

  if ((packageIdInput || packageLegacyInput || packageNameInput) && !selectedPackage) {
    return {
      type: "failed",
      failure: {
        rowIndex,
        reason: "Package reference not found for branch",
        memberName: fullName,
        raw: row,
      },
    };
  }

  const monthlyFeeAmount = toNumberValue(
    pickValue(row, ["monthly_fee_amount", "monthly_fee", "monthlyamount"]),
  );
  const customMonthlyFlag = toBooleanValue(
    pickValue(row, ["custom_monthly_fee", "custommonthlyfee", "monthly_member"]),
  );

  const wantsMonthly =
    customMonthlyFlag === true ||
    (monthlyFeeAmount !== undefined && Number.isFinite(monthlyFeeAmount));

  const paymentMethod = parsePaymentMethod(
    pickValue(row, ["payment_method", "paymentmethod"]),
  );
  const paidTotal = toNumberValue(
    pickValue(row, ["paid_total", "paid_amount", "paid"]),
  );
  const discount = toNumberValue(pickValue(row, ["discount"]));
  const admissionFee = toNumberValue(
    pickValue(row, ["admission_fee", "admissionfee", "registration_fee"]),
  );
  const paymentDate = toDateValue(pickValue(row, ["payment_date", "paymentdate"]));
  const paymentStatus = parsePaymentStatus(
    pickValue(row, ["payment_status", "status"]),
  );

  const hasPaymentInfo = paymentMethod !== undefined && paidTotal !== undefined;

  const startDate =
    toDateValue(pickValue(row, ["membership_start_date", "start_date", "startdate"])) ||
    new Date();

  const paidMonthsRaw = toNumberValue(pickValue(row, ["paid_months", "months"]));
  const paidMonths = paidMonthsRaw && paidMonthsRaw > 0 ? Math.floor(paidMonthsRaw) : 1;

  const warningMessages: string[] = [];

  let currentPackageId: Types.ObjectId | undefined;
  let currentPackageName: string | undefined;
  let membershipEndDate: Date | undefined;
  let nextPaymentDate: Date | undefined;
  let paymentType: PaymentType | undefined;
  let periodEnd: Date | undefined;
  let subTotal = 0;
  let packageDuration: number | undefined;
  let packageDurationType: string | undefined;

  if (selectedPackage) {
    currentPackageId = selectedPackage._id as Types.ObjectId;
    currentPackageName = selectedPackage.title;
    membershipEndDate = addDuration(
      startDate,
      selectedPackage.duration,
      selectedPackage.durationType,
    );
    nextPaymentDate = membershipEndDate;
    paymentType = PaymentType.PACKAGE;
    periodEnd = membershipEndDate;
    packageDuration = selectedPackage.duration;
    packageDurationType = selectedPackage.durationType;
    subTotal = selectedPackage.amount + (admissionFee || 0);
  } else if (wantsMonthly && monthlyFeeAmount && monthlyFeeAmount > 0) {
    paymentType = PaymentType.MONTHLY;
    periodEnd = addMonths(startDate, paidMonths);
    nextPaymentDate = periodEnd;
    subTotal = monthlyFeeAmount * paidMonths + (admissionFee || 0);
  } else {
    warningMessages.push("No valid package or monthly plan found; member saved as draft");
  }

  if (!hasPaymentInfo) {
    warningMessages.push("Payment information missing; member saved as inactive draft");
  }

  const isActive = warningMessages.length === 0;

  const memberData: TMember = {
    branchId: branchObjectId,
    legacyId,
    memberId,
    barcode,
    fullName,
    contact,
    email,
    dateOfBirth: toDateValue(pickValue(row, ["date_of_birth", "dob"])),
    country: toStringValue(pickValue(row, ["country"])),
    nid: toStringValue(pickValue(row, ["nid", "national_id"])),
    gender: toStringValue(pickValue(row, ["gender"])),
    bloodGroup: toStringValue(pickValue(row, ["blood_group", "bloodgroup"])),
    height: toNumberValue(pickValue(row, ["height"])),
    heightUnit: toStringValue(pickValue(row, ["height_unit", "heightunit"])) as
      | "cm"
      | "in"
      | "ft"
      | undefined,
    weight: toNumberValue(pickValue(row, ["weight"])),
    weightUnit: toStringValue(pickValue(row, ["weight_unit", "weightunit"])) as
      | "kg"
      | "lb"
      | undefined,
    address: toStringValue(pickValue(row, ["address"])),
    emergencyContact:
      toStringValue(pickValue(row, ["emergency_contact_number", "emergency_number"]))
        ? {
            relationship:
              toStringValue(
                pickValue(row, ["emergency_contact_relationship", "emergency_relationship"]),
              ) || "Unknown",
            contactNumber:
              toStringValue(
                pickValue(row, ["emergency_contact_number", "emergency_number"]),
              ) || "",
          }
        : undefined,
    trainingGoals: parseTrainingGoals(
      pickValue(row, ["training_goals", "training_goal", "goals"]),
    ),
    currentPackageId,
    currentPackageName,
    membershipStartDate: startDate,
    membershipEndDate,
    nextPaymentDate,
    isActive,
    customMonthlyFee: !selectedPackage && wantsMonthly,
    monthlyFeeAmount: !selectedPackage ? monthlyFeeAmount : undefined,
    paidMonths: !selectedPackage ? paidMonths : undefined,
    source: "google_sheet",
    importBatchId: batchId,
    metadata: {
      importRowIndex: rowIndex,
      importWarnings: warningMessages,
      rawPackageInput: packageNameInput || packageLegacyInput || packageIdInput,
    },
  };

  const member = await persistMember(branchObjectId, memberData, {
    legacyId,
    memberId,
    barcode,
    email,
    contact,
    fullName,
  });

  if (hasPaymentInfo && paymentType && periodEnd && member._id) {
    const dueAmount = Math.max(subTotal - (discount || 0) - (paidTotal || 0), 0);

    try {
      await persistPayment(
        {
          branchId: branchObjectId,
          memberId: member._id as Types.ObjectId,
          memberLegacyId: legacyId,
          packageId: currentPackageId,
          packageLegacyId: selectedPackage?.legacyId,
          packageName: currentPackageName,
          packageDuration,
          packageDurationType,
          paymentType,
          periodStart: startDate,
          periodEnd,
          paidMonths: !selectedPackage ? paidMonths : undefined,
          year: startDate.getFullYear(),
          subTotal,
          discount,
          dueAmount,
          paidTotal,
          admissionFee,
          paymentMethod,
          paymentDate: paymentDate || new Date(),
          nextPaymentDate,
          status: computePaymentStatus(dueAmount, paidTotal || 0, paymentStatus),
          source: "google_sheet",
          importBatchId: batchId,
        },
        fullName,
      );
    } catch (error) {
      await MemberRepository.updateById(String(member._id), {
        isActive: false,
        metadata: {
          ...(member.metadata || {}),
          importWarnings: [
            ...(Array.isArray((member.metadata as any)?.importWarnings)
              ? ((member.metadata as any).importWarnings as string[])
              : []),
            "Payment could not be saved; member moved to draft",
          ],
        },
      });

      warningMessages.push("Payment could not be saved; member moved to draft");
      errorLogger.error("Member import payment save failed", {
        batchId,
        rowIndex,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (warningMessages.length > 0) {
    return {
      type: "success",
      warning: {
        rowIndex,
        memberName: fullName,
        reason: warningMessages.join("; "),
        raw: row,
      },
    };
  }

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
        : await getSheetRows(batch.spreadsheetId, batch.range);

    if (rowsFromSource.length > runtimeConfig.maxRowsPerBatch) {
      throw new AppError(
        StatusCodes.BAD_REQUEST,
        `Maximum import rows exceeded. Limit is ${runtimeConfig.maxRowsPerBatch}`,
      );
    }

    const packageLookup = await createPackageLookup(String(batch.branchId));

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
          packageLookup,
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
  listImportBatches,
  getImportMetrics,
  getImportBatchById,
  requestCancelImport,
  retryFailedRows,
  resumePendingBatches,
};
