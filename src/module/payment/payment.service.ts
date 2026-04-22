import { StatusCodes } from "http-status-codes";
import mongoose, { Types } from "mongoose";

import { QueryBuilder } from "../../Builder/QueryBuilder";
import AppError from "../../errors/AppError";
import cacheService from "../../redis/cacheService";
import { BranchRepository } from "../branch/branch.repository";
import { BusinessProfileRepository } from "../businessProfile/businessProfile.repository";
import {
  buildMemberBillingUpdate,
  calculateMonthlyCycleEndDate,
  reconcileMemberBillingState,
  resolveMemberMonthlyFeeAmount,
} from "../member/member.billing";
import {
  alignMemberBillingLedgerToDueAmount,
  createMemberBillingLedgerItem,
  hasMemberBillingLedgerChanged,
  mergeMemberBillingLedgerMetadata,
  reconcileMemberBillingLedger,
  TMemberBillingLedger,
  TMemberBillingLedgerItem,
  TMemberBillingLedgerItemType,
} from "../member/member.billingLedger";
import { Member } from "../member/member.model";
import { MemberRepository } from "../member/member.repository";
import { PackageDurationType } from "../package/package.interface";
import { PackageRepository } from "../package/package.repository";
import { TStaff } from "../staff/staff.interface";
import {
  addMonthsPreservingDay,
  applyNetBalanceDelta,
  computePaymentSettlement,
  normalizeMoney,
  toMemberBalanceSnapshot,
} from "./payment.balance";
import {
  PaymentStatus,
  PaymentType,
  TPayment,
} from "./payment.interface";
import { PaymentRepository } from "./payment.repository";

type TAccessActor = {
  userId?: Types.ObjectId;
  staff?: TStaff;
};

type TCreatePaymentPayload = Omit<TPayment, "branchId" | "createdAt" | "updatedAt">;

type TUpdatePaymentPayload = Partial<
  Omit<
    TPayment,
    | "branchId"
    | "legacyId"
    | "memberId"
    | "memberLegacyId"
    | "packageId"
    | "packageLegacyId"
    | "createdAt"
    | "updatedAt"
  >
>;

type TQueryPayment = {
  searchTerm?: string;
  legacyId?: string;
  memberId?: string;
  memberLegacyId?: string;
  packageId?: string;
  paymentType?: string;
  paymentMethod?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  minAmount?: string;
  maxAmount?: string;
  year?: string;
  sort?: string;
  page?: string;
  limit?: string;
  fields?: string;
};

type TCollectBillMode = "due_only" | "monthly" | "package";

type TCollectBillPayload = {
  memberId: string;
  collectionMode: TCollectBillMode;
  selectedDueItems?: Array<{
    ledgerItemId: string;
    amount: number;
  }>;
  duePaymentAmount?: number;
  paidTotal: number;
  paymentMethod?: TPayment["paymentMethod"];
  paymentDate?: Date | string;
  discount?: number;
  startDate?: Date | string;
  paidMonths?: number;
  packageId?: string;
  note?: string;
  useCustomMonthlyFee?: boolean;
  customMonthlyFeeAmount?: number;
};

type TResolvedCollectBillDueSelection = {
  ledgerItemId: string;
  label: string;
  ledgerItemType: TMemberBillingLedgerItemType;
  requestedAmount: number;
  dueDate?: string;
  periodStart?: string;
  periodEnd?: string;
  packageId?: string;
};

type TCollectBillInvoiceLine = {
  key: string;
  kind: "selected_due" | "cycle";
  lineType: TMemberBillingLedgerItemType | "monthly_cycle" | "package_cycle";
  label: string;
  amount: number;
  ledgerItemId?: string;
  dueDate?: string;
  periodStart?: Date;
  periodEnd?: Date;
  packageId?: string;
  packageName?: string;
  paidMonths?: number;
};

type TResolvedCollectBillInvoiceLine = TCollectBillInvoiceLine & {
  advanceAppliedAmount: number;
  discountAppliedAmount: number;
  paidAppliedAmount: number;
  resolvedAmount: number;
  unresolvedAmount: number;
};

type TCollectBillCycleDetails = {
  collectionMode: TCollectBillMode;
  paymentType: PaymentType;
  cycleCharge: number;
  admissionFeeAmount?: number;
  periodStart?: Date;
  periodEnd?: Date;
  nextPaymentDate?: Date;
  packageId?: Types.ObjectId;
  packageName?: string;
  packageDuration?: number;
  packageDurationType?: string;
  paidMonths?: number;
  memberUpdate: Record<string, unknown>;
  memberUnset?: Record<string, 1>;
};

const getBillingReconcileCacheKey = (branchId: string) =>
  `members:${branchId}:billing-reconciled`;

const resolveBranchAccess = async (branchId: string, actor: TAccessActor) => {
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

const isTransactionNotSupported = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();

  return (
    message.includes("transaction numbers are only allowed") ||
    message.includes("transactions are not supported") ||
    message.includes("replica set")
  );
};

const invalidateMemberBillingCaches = async (
  branchId: string,
  memberId: string,
) => {
  await Promise.all([
    cacheService.deleteCache(`members:${branchId}:${memberId}`),
    cacheService.deleteCache(getBillingReconcileCacheKey(branchId)),
    cacheService.invalidateByPattern(`members:${branchId}:list:*`),
  ]);
};

const addPackageDuration = (
  date: Date,
  duration: number,
  durationType: string,
): Date => {
  const nextDate = new Date(date);

  switch (durationType) {
    case PackageDurationType.DAY:
      nextDate.setDate(nextDate.getDate() + duration);
      return nextDate;
    case PackageDurationType.WEEK:
      nextDate.setDate(nextDate.getDate() + duration * 7);
      return nextDate;
    case PackageDurationType.MONTH:
      return addMonthsPreservingDay(nextDate, duration);
    case PackageDurationType.YEAR:
      nextDate.setFullYear(nextDate.getFullYear() + duration);
      return nextDate;
    default:
      return addMonthsPreservingDay(nextDate, duration);
  }
};

const mapDueLedgerItemToResponse = (item: TMemberBillingLedgerItem) => ({
  ledgerItemId: item.key,
  type: item.type,
  label: item.label,
  originalAmount: normalizeMoney(item.originalAmount),
  remainingAmount: normalizeMoney(item.remainingAmount),
  dueDate: item.dueDate,
  periodStart: item.periodStart,
  periodEnd: item.periodEnd,
  packageId: item.packageId,
});

const allocateCollectBillCoverage = ({
  lines,
  advanceAmount = 0,
  discount = 0,
  paidTotal = 0,
}: {
  lines: TCollectBillInvoiceLine[];
  advanceAmount?: number;
  discount?: number;
  paidTotal?: number;
}) => {
  let remainingAdvanceAmount = normalizeMoney(advanceAmount);
  let remainingDiscount = normalizeMoney(discount);
  let remainingPaidTotal = normalizeMoney(paidTotal);

  return lines.map<TResolvedCollectBillInvoiceLine>((line) => {
    let unresolvedAmount = normalizeMoney(line.amount);

    const advanceAppliedAmount = Math.min(unresolvedAmount, remainingAdvanceAmount);
    unresolvedAmount = normalizeMoney(unresolvedAmount - advanceAppliedAmount);
    remainingAdvanceAmount = normalizeMoney(
      remainingAdvanceAmount - advanceAppliedAmount,
    );

    const discountAppliedAmount = Math.min(unresolvedAmount, remainingDiscount);
    unresolvedAmount = normalizeMoney(unresolvedAmount - discountAppliedAmount);
    remainingDiscount = normalizeMoney(remainingDiscount - discountAppliedAmount);

    const paidAppliedAmount = Math.min(unresolvedAmount, remainingPaidTotal);
    unresolvedAmount = normalizeMoney(unresolvedAmount - paidAppliedAmount);
    remainingPaidTotal = normalizeMoney(remainingPaidTotal - paidAppliedAmount);

    return {
      ...line,
      advanceAppliedAmount,
      discountAppliedAmount,
      paidAppliedAmount,
      resolvedAmount: normalizeMoney(
        advanceAppliedAmount + discountAppliedAmount + paidAppliedAmount,
      ),
      unresolvedAmount,
    };
  });
};

const buildCollectBillCycleLine = (
  cycleDetails: TCollectBillCycleDetails,
): TCollectBillInvoiceLine | null => {
  if (cycleDetails.cycleCharge <= 0) {
    return null;
  }

  if (cycleDetails.collectionMode === "package") {
    return {
      key: `package_cycle:${String(cycleDetails.packageId || cycleDetails.packageName || "package")}`,
      kind: "cycle",
      lineType: "package_cycle",
      label: cycleDetails.packageName || "Package move",
      amount: cycleDetails.cycleCharge,
      periodStart: cycleDetails.periodStart,
      periodEnd: cycleDetails.periodEnd,
      packageId: cycleDetails.packageId ? String(cycleDetails.packageId) : undefined,
      packageName: cycleDetails.packageName,
    };
  }

  return {
    key: `monthly_cycle:${String(cycleDetails.periodStart || "monthly")}`,
    kind: "cycle",
    lineType: "monthly_cycle",
    label:
      cycleDetails.paidMonths && cycleDetails.paidMonths > 1
        ? `Future monthly payment (${cycleDetails.paidMonths} months)`
        : "Future monthly payment",
    amount: cycleDetails.cycleCharge,
    periodStart: cycleDetails.periodStart,
    periodEnd: cycleDetails.periodEnd,
    paidMonths: cycleDetails.paidMonths,
  };
};

const resolveCollectBillDueSelections = (
  dueLedger: TMemberBillingLedger,
  payload: TCollectBillPayload,
) => {
  if (payload.selectedDueItems?.length) {
    const dueItemsById = new Map(
      dueLedger.items.map((item) => [item.key, item] as const),
    );

    return payload.selectedDueItems.map<TResolvedCollectBillDueSelection>((item) => {
      const ledgerItem = dueItemsById.get(item.ledgerItemId);

      if (!ledgerItem) {
        throw new AppError(
          StatusCodes.BAD_REQUEST,
          `Selected due item ${item.ledgerItemId} was not found`,
        );
      }

      const requestedAmount = normalizeMoney(item.amount);

      if (requestedAmount <= 0) {
        throw new AppError(
          StatusCodes.BAD_REQUEST,
          "Selected due amounts must be greater than 0",
        );
      }

      if (requestedAmount > normalizeMoney(ledgerItem.remainingAmount)) {
        throw new AppError(
          StatusCodes.BAD_REQUEST,
          `${ledgerItem.label} exceeds the remaining due amount`,
        );
      }

      return {
        ledgerItemId: ledgerItem.key,
        label: ledgerItem.label,
        ledgerItemType: ledgerItem.type,
        requestedAmount,
        dueDate: ledgerItem.dueDate,
        periodStart: ledgerItem.periodStart,
        periodEnd: ledgerItem.periodEnd,
        packageId: ledgerItem.packageId,
      };
    });
  }

  const legacyDuePaymentAmount = normalizeMoney(payload.duePaymentAmount ?? 0);

  if (legacyDuePaymentAmount <= 0) {
    return [];
  }

  let remainingAmount = legacyDuePaymentAmount;
  const selectedItems: TResolvedCollectBillDueSelection[] = [];

  for (const ledgerItem of dueLedger.items) {
    if (remainingAmount <= 0) {
      break;
    }

    const requestedAmount = Math.min(
      normalizeMoney(ledgerItem.remainingAmount),
      remainingAmount,
    );

    selectedItems.push({
      ledgerItemId: ledgerItem.key,
      label: ledgerItem.label,
      ledgerItemType: ledgerItem.type,
      requestedAmount,
      dueDate: ledgerItem.dueDate,
      periodStart: ledgerItem.periodStart,
      periodEnd: ledgerItem.periodEnd,
      packageId: ledgerItem.packageId,
    });

    remainingAmount = normalizeMoney(remainingAmount - requestedAmount);
  }

  if (remainingAmount > 0) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "Due payment amount exceeds the member's outstanding due items",
    );
  }

  return selectedItems;
};

const updateCollectBillDueLedger = ({
  dueLedger,
  resolvedInvoiceLines,
  finalDueAmount,
  paymentDate,
}: {
  dueLedger: TMemberBillingLedger;
  resolvedInvoiceLines: TResolvedCollectBillInvoiceLine[];
  finalDueAmount: number;
  paymentDate: Date;
}) => {
  const nextItems = dueLedger.items.map((item) => ({ ...item }));

  resolvedInvoiceLines.forEach((line) => {
    if (line.kind === "selected_due" && line.ledgerItemId) {
      const ledgerItem = nextItems.find((item) => item.key === line.ledgerItemId);

      if (ledgerItem && line.resolvedAmount > 0) {
        ledgerItem.remainingAmount = normalizeMoney(
          ledgerItem.remainingAmount - line.resolvedAmount,
        );
      }

      return;
    }

    if (line.kind === "cycle" && line.unresolvedAmount > 0) {
      nextItems.push(
        createMemberBillingLedgerItem({
          type:
            line.lineType === "package_cycle"
              ? "package_due"
              : "monthly_cycle_due",
          label: line.label,
          amount: line.unresolvedAmount,
          now: paymentDate,
          dueDate: paymentDate,
          periodStart: line.periodStart,
          periodEnd: line.periodEnd,
          packageId: line.packageId,
        }),
      );
    }
  });

  return alignMemberBillingLedgerToDueAmount(nextItems, finalDueAmount, paymentDate);
};

const resolveCollectBillMember = async (
  branchId: string,
  actor: TAccessActor,
  memberId: string,
) => {
  const branch = await resolveBranchAccess(branchId, actor);

  const member = await MemberRepository.findOne({
    _id: new Types.ObjectId(memberId),
    branchId: new Types.ObjectId(branchId),
  });

  if (!member) {
    throw new AppError(StatusCodes.NOT_FOUND, "Member not found");
  }

  const billing = reconcileMemberBillingState(member, branch);
  const dueLedger = reconcileMemberBillingLedger(member, billing);
  const shouldPersistLedger = hasMemberBillingLedgerChanged(
    member.metadata,
    dueLedger,
  );

  if (!billing.shouldPersist && !shouldPersistLedger) {
    return { branch, member, billing, dueLedger };
  }

  const updatedMember = await MemberRepository.updateById(
    String(member._id),
    {
      ...buildMemberBillingUpdate(billing),
      metadata: mergeMemberBillingLedgerMetadata(member.metadata, dueLedger),
    },
  );

  if (!updatedMember) {
    throw new AppError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      "Failed to persist the reconciled member billing state",
    );
  }

  await invalidateMemberBillingCaches(branchId, String(member._id));

  return {
    branch,
    member: updatedMember,
    billing,
    dueLedger,
  };
};

const resolveCollectBillCycleDetails = async (
  branchId: string,
  branch: NonNullable<Awaited<ReturnType<typeof BranchRepository.findOne>>>,
  member: Awaited<ReturnType<typeof MemberRepository.findOne>>,
  payload: TCollectBillPayload,
): Promise<TCollectBillCycleDetails> => {
  const startDate =
    payload.startDate instanceof Date
      ? payload.startDate
      : payload.startDate
        ? new Date(payload.startDate)
        : payload.collectionMode === "monthly" && member?.nextPaymentDate
          ? new Date(member.nextPaymentDate)
          : new Date();

  switch (payload.collectionMode) {
    case "due_only":
      return {
        collectionMode: payload.collectionMode,
        paymentType: PaymentType.OTHER,
        cycleCharge: 0,
        packageName: "Due Settlement",
        nextPaymentDate: member?.nextPaymentDate,
        memberUpdate: {},
      };

    case "monthly": {
      const paidMonths = payload.paidMonths && payload.paidMonths > 0 ? payload.paidMonths : 0;

      // Resolve monthly fee: explicit custom override > member custom > branch default
      const useCustom =
        payload.useCustomMonthlyFee === true &&
        payload.customMonthlyFeeAmount != null &&
        payload.customMonthlyFeeAmount > 0;
      const monthlyFeeAmount = useCustom
        ? payload.customMonthlyFeeAmount!
        : member
          ? resolveMemberMonthlyFeeAmount(member, branch)
          : undefined;

      if (!paidMonths) {
        throw new AppError(StatusCodes.BAD_REQUEST, "Paid months is required");
      }

      if (monthlyFeeAmount == null) {
        throw new AppError(
          StatusCodes.BAD_REQUEST,
          "Monthly fee is not configured for this member or branch",
        );
      }

      const periodEnd = calculateMonthlyCycleEndDate(startDate, paidMonths);

      return {
        collectionMode: payload.collectionMode,
        paymentType: PaymentType.MONTHLY,
        cycleCharge: normalizeMoney(monthlyFeeAmount * paidMonths),
        periodStart: startDate,
        periodEnd,
        nextPaymentDate: periodEnd,
        paidMonths,
        packageName: "Monthly Renewal",
        memberUpdate: {
          membershipStartDate: startDate,
          paidMonths,
          nextPaymentDate: periodEnd,
          isActive: true,
          ...(useCustom
            ? { isCustomMonthlyFee: true, customMonthlyFeeAmount: monthlyFeeAmount }
            : {}),
        },
        memberUnset: {
          currentPackageId: 1,
          currentPackageName: 1,
          membershipEndDate: 1,
        },
      };
    }

    case "package": {
      if (!payload.packageId || !Types.ObjectId.isValid(payload.packageId)) {
        throw new AppError(StatusCodes.BAD_REQUEST, "A valid package is required");
      }

      const packageDoc = await PackageRepository.findOne({
        _id: new Types.ObjectId(payload.packageId),
        branchId: new Types.ObjectId(branchId),
        isActive: true,
      });

      if (!packageDoc) {
        throw new AppError(StatusCodes.NOT_FOUND, "Package not found in this branch");
      }

      const admissionFeeAmount = packageDoc.includeAdmissionFee
        ? typeof packageDoc.admissionFeeAmount === "number"
          ? packageDoc.admissionFeeAmount
          : typeof branch?.admissionFeeAmount === "number"
            ? branch.admissionFeeAmount
            : 0
        : 0;

      const periodEnd = addPackageDuration(
        startDate,
        packageDoc.duration,
        packageDoc.durationType,
      );

      return {
        collectionMode: payload.collectionMode,
        paymentType: PaymentType.PACKAGE,
        cycleCharge: normalizeMoney(packageDoc.amount + admissionFeeAmount),
        admissionFeeAmount,
        periodStart: startDate,
        periodEnd,
        nextPaymentDate: periodEnd,
        packageId: packageDoc._id as Types.ObjectId,
        packageName: packageDoc.title,
        packageDuration: packageDoc.duration,
        packageDurationType: packageDoc.durationType,
        memberUpdate: {
          currentPackageId: packageDoc._id as Types.ObjectId,
          currentPackageName: packageDoc.title,
          membershipStartDate: startDate,
          membershipEndDate: periodEnd,
          nextPaymentDate: periodEnd,
          isActive: true,
        },
        memberUnset: {
          paidMonths: 1,
        },
      };
    }

    default:
      throw new AppError(StatusCodes.BAD_REQUEST, "Unsupported collection mode");
  }
};

const persistCollectedBill = async (
  memberId: string,
  paymentData: TPayment,
  memberUpdatePayload: Record<string, unknown>,
) => {
  let session: mongoose.ClientSession | null = null;

  try {
    session = await mongoose.startSession();
    session.startTransaction();

    const payment = await PaymentRepository.create(paymentData, { session });
    const updatedMember = await Member.findByIdAndUpdate(memberId, memberUpdatePayload, {
      returnDocument: "after",
      runValidators: true,
      session,
    });

    if (!updatedMember) {
      throw new AppError(StatusCodes.INTERNAL_SERVER_ERROR, "Failed to update member");
    }

    await session.commitTransaction();
    return payment;
  } catch (error) {
    if (session) {
      await session.abortTransaction();
    }

    if (!isTransactionNotSupported(error)) {
      throw error;
    }
  } finally {
    if (session) {
      await session.endSession();
    }
  }

  const payment = await PaymentRepository.create(paymentData);

  try {
    const updatedMember = await MemberRepository.updateById(memberId, memberUpdatePayload);

    if (!updatedMember) {
      throw new AppError(StatusCodes.INTERNAL_SERVER_ERROR, "Failed to update member");
    }

    return payment;
  } catch (error) {
    await PaymentRepository.deleteById(String(payment._id));
    throw error;
  }
};

const getPaymentNetEffect = (
  payment: Pick<TPayment, "dueAmount" | "advanceAmount" | "status">,
): number => {
  if (
    payment.status === PaymentStatus.CANCELLED ||
    payment.status === PaymentStatus.REFUNDED
  ) {
    return 0;
  }

  return normalizeMoney((payment.dueAmount ?? 0) - (payment.advanceAmount ?? 0));
};

const syncMemberBalanceDelta = async (
  branchId: string,
  memberId: string,
  netDelta: number,
) => {
  if (netDelta === 0) {
    return;
  }

  const member = await MemberRepository.findById(memberId);

  if (!member) {
    return;
  }

  const nextBalance = applyNetBalanceDelta(member, netDelta);

  await MemberRepository.updateById(memberId, nextBalance);
  await Promise.all([
    cacheService.deleteCache(`members:${branchId}:${memberId}`),
    cacheService.deleteCache(getBillingReconcileCacheKey(branchId)),
    cacheService.invalidateByPattern(`members:${branchId}:list:*`),
  ]);
};

const generateInvoiceNo = async (branchId: string): Promise<string> => {
  const year = new Date().getFullYear();
  const count = await PaymentRepository.count({
    branchId: new Types.ObjectId(branchId),
  });

  return `INV-${year}-${String(count + 1).padStart(6, "0")}`;
};

const resolveMemberData = async (
  branchId: string,
  payload: TCreatePaymentPayload,
): Promise<{
  memberId?: Types.ObjectId;
  memberName?: string;
}> => {
  // If memberId is provided, fetch and validate member
  if (payload.memberId) {
    const member = await MemberRepository.findOne({
      _id: new Types.ObjectId(payload.memberId),
      branchId: new Types.ObjectId(branchId),
    });

    if (!member) {
      throw new AppError(StatusCodes.NOT_FOUND, "Member not found in this branch");
    }

    return {
      memberId: member._id as Types.ObjectId,
      memberName: member.fullName,
    };
  }

  // For imported payments with memberLegacyId, try to resolve
  if (payload.memberLegacyId) {
    const member = await MemberRepository.findOne({
      legacyId: payload.memberLegacyId,
      branchId: new Types.ObjectId(branchId),
    });

    if (member) {
      return {
        memberId: member._id as Types.ObjectId,
        memberName: member.fullName,
      };
    }
  }

  // Return whatever was provided (for imported data compatibility)
  return {
    memberName: payload.memberName,
  };
};

const resolvePackageData = async (
  branchId: string,
  payload: TCreatePaymentPayload,
): Promise<{
  packageId?: Types.ObjectId;
  packageName?: string;
  packageDuration?: number;
  packageDurationType?: string;
}> => {
  // If packageId is provided, fetch and validate package
  if (payload.packageId) {
    const packageDoc = await PackageRepository.findOne({
      _id: new Types.ObjectId(payload.packageId),
      branchId: new Types.ObjectId(branchId),
    });

    if (!packageDoc) {
      throw new AppError(StatusCodes.NOT_FOUND, "Package not found in this branch");
    }

    return {
      packageId: packageDoc._id as Types.ObjectId,
      packageName: packageDoc.title,
      packageDuration: packageDoc.duration,
      packageDurationType: packageDoc.durationType,
    };
  }

  // For imported payments with packageLegacyId, try to resolve
  if (payload.packageLegacyId) {
    const packageDoc = await PackageRepository.findOne({
      legacyId: payload.packageLegacyId,
      branchId: new Types.ObjectId(branchId),
    });

    if (packageDoc) {
      return {
        packageId: packageDoc._id as Types.ObjectId,
        packageName: packageDoc.title,
        packageDuration: packageDoc.duration,
        packageDurationType: packageDoc.durationType,
      };
    }
  }

  // Return whatever was provided (for imported data compatibility)
  return {
    packageName: payload.packageName,
    packageDuration: payload.packageDuration,
    packageDurationType: payload.packageDurationType,
  };
};

const createPayment = async (
  branchId: string,
  actor: TAccessActor,
  payload: TCreatePaymentPayload,
) => {
  await resolveBranchAccess(branchId, actor);

  // Resolve member and package data (handles both manual and imported)
  const memberData = await resolveMemberData(branchId, payload);
  const packageData = await resolvePackageData(branchId, payload);

  // Generate invoice number if not provided
  const invoiceNo = payload.invoiceNo || (await generateInvoiceNo(branchId));

  const discount = payload.discount || 0;
  const subTotal = payload.subTotal ?? 0;
  const paidTotal = payload.paidTotal ?? 0;
  const settlement = computePaymentSettlement({
    subTotal,
    paidTotal,
    discount,
  });

  // Determine payment status
  const status = computePaymentStatus(
    settlement.dueAmount,
    paidTotal,
    payload.status,
  );

  const paymentData: TPayment = {
    ...payload,
    ...memberData,
    ...packageData,
    branchId: new Types.ObjectId(branchId),
    invoiceNo,
    dueAmount: settlement.dueAmount,
    advanceAmount: settlement.advanceAmount,
    status,
    paymentDate: payload.paymentDate || new Date(),
    source: payload.source || "MANUAL",
  };

  const payment = await PaymentRepository.create(paymentData);

  if (paymentData.memberId) {
    await syncMemberBalanceDelta(
      branchId,
      paymentData.memberId.toString(),
      getPaymentNetEffect(paymentData),
    );
  }

  return payment;
};

const getCollectBillContext = async (
  branchId: string,
  memberId: string,
  actor: TAccessActor,
) => {
  const { member, billing, dueLedger } = await resolveCollectBillMember(
    branchId,
    actor,
    memberId,
  );

  const dueBreakdown = dueLedger.items.map(mapDueLedgerItemToResponse);
  const overdueAmount = normalizeMoney(
    dueLedger.items
      .filter((item) => item.type === "monthly_due")
      .reduce((total, item) => total + item.remainingAmount, 0),
  );

  return {
    member,
    billing: {
      currentDueAmount: member.currentDueAmount ?? billing.currentDueAmount,
      currentAdvanceAmount:
        member.currentAdvanceAmount ?? billing.currentAdvanceAmount,
      overdueMonths: dueLedger.items.filter((item) => item.type === "monthly_due").length,
      accruedAmount: overdueAmount,
      monthlyFeeAmount: billing.monthlyFeeAmount,
      nextPaymentDate: member.nextPaymentDate,
      recommendedStartDate: member.nextPaymentDate || new Date(),
      isActive: member.isActive !== false,
      dueBreakdown,
    },
  };
};

const collectBill = async (
  branchId: string,
  actor: TAccessActor,
  payload: TCollectBillPayload,
) => {
  const { branch, member, billing, dueLedger } = await resolveCollectBillMember(
    branchId,
    actor,
    payload.memberId,
  );

  const cycleDetails = await resolveCollectBillCycleDetails(
    branchId,
    branch,
    member,
    payload,
  );
  const paymentDate =
    payload.paymentDate instanceof Date
      ? payload.paymentDate
      : payload.paymentDate
        ? new Date(payload.paymentDate)
        : new Date();

  const openingNetBalance = normalizeMoney(
    (member.currentDueAmount ?? 0) - (member.currentAdvanceAmount ?? 0),
  );
  const openingDueAmount = normalizeMoney(member.currentDueAmount ?? 0);
  const openingAdvanceAmount = normalizeMoney(member.currentAdvanceAmount ?? 0);
  const discount = normalizeMoney(payload.discount ?? 0);
  const paidTotal = normalizeMoney(payload.paidTotal ?? 0);
  const selectedDueItems = resolveCollectBillDueSelections(dueLedger, payload);
  const selectedDueAmount = normalizeMoney(
    selectedDueItems.reduce((total, item) => total + item.requestedAmount, 0),
  );

  if (selectedDueAmount > openingDueAmount) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "Selected due amount cannot exceed the member's current due",
    );
  }

  if (payload.collectionMode === "due_only" && selectedDueItems.length === 0) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "Select at least one due item before collecting a due-only bill",
    );
  }

  const cycleLine = buildCollectBillCycleLine(cycleDetails);
  const invoiceLines: TCollectBillInvoiceLine[] = [
    ...selectedDueItems.map((item) => ({
      key: `selected_due:${item.ledgerItemId}`,
      kind: "selected_due" as const,
      lineType: item.ledgerItemType,
      label: item.label,
      amount: item.requestedAmount,
      ledgerItemId: item.ledgerItemId,
      dueDate: item.dueDate,
      periodStart: item.periodStart ? new Date(item.periodStart) : undefined,
      periodEnd: item.periodEnd ? new Date(item.periodEnd) : undefined,
      packageId: item.packageId,
    })),
    ...(cycleLine ? [cycleLine] : []),
  ];

  if (invoiceLines.length === 0) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "Select at least one due item or billing cycle before collecting a bill",
    );
  }

  const subTotal = normalizeMoney(
    invoiceLines.reduce((total, line) => total + line.amount, 0),
  );

  if (subTotal <= 0 && paidTotal <= 0) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "There is no payable amount to collect for this bill",
    );
  }

  if (discount > subTotal) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "Discount cannot exceed the selected bill total",
    );
  }

  const settlement = computePaymentSettlement({
    subTotal,
    paidTotal,
    discount,
  });
  const resolvedInvoiceLines = allocateCollectBillCoverage({
    lines: invoiceLines,
    advanceAmount: openingAdvanceAmount,
    discount,
    paidTotal,
  });
  const effectiveDuePaymentAmount = normalizeMoney(
    resolvedInvoiceLines
      .filter((line) => line.kind === "selected_due")
      .reduce((total, line) => total + line.resolvedAmount, 0),
  );
  const finalNetBalance = normalizeMoney(
    openingNetBalance - selectedDueAmount + settlement.netAmount,
  );
  const finalBalanceSnapshot = toMemberBalanceSnapshot(finalNetBalance);
  const finalNextPaymentDate =
    cycleDetails.nextPaymentDate ?? billing.updatedNextPaymentDate ?? member.nextPaymentDate;
  const updatedDueLedger = updateCollectBillDueLedger({
    dueLedger,
    resolvedInvoiceLines,
    finalDueAmount: finalBalanceSnapshot.currentDueAmount,
    paymentDate,
  });

  const memberUpdatePayload: Record<string, unknown> = {
    ...buildMemberBillingUpdate({
      currentDueAmount: finalBalanceSnapshot.currentDueAmount,
      currentAdvanceAmount: finalBalanceSnapshot.currentAdvanceAmount,
      updatedNextPaymentDate: finalNextPaymentDate,
    }),
    ...cycleDetails.memberUpdate,
    metadata: mergeMemberBillingLedgerMetadata(member.metadata, updatedDueLedger),
  };

  if (cycleDetails.memberUnset && Object.keys(cycleDetails.memberUnset).length > 0) {
    memberUpdatePayload.$unset = cycleDetails.memberUnset;
  }

  const invoiceNo = await generateInvoiceNo(branchId);
  const paymentData: TPayment = {
    branchId: new Types.ObjectId(branchId),
    invoiceNo,
    memberId: member._id as Types.ObjectId,
    memberLegacyId: member.legacyId,
    memberName: member.fullName,
    packageId: cycleDetails.packageId,
    packageName: cycleDetails.packageName,
    packageDuration: cycleDetails.packageDuration,
    packageDurationType: cycleDetails.packageDurationType,
    paymentType: cycleDetails.paymentType,
    periodStart: cycleDetails.periodStart,
    periodEnd: cycleDetails.periodEnd,
    paidMonths: cycleDetails.paidMonths,
    year: (cycleDetails.periodStart || paymentDate).getFullYear(),
    subTotal,
    discount,
    dueAmount: settlement.dueAmount,
    advanceAmount: settlement.advanceAmount,
    paidTotal,
    admissionFee: cycleDetails.admissionFeeAmount,
    paymentMethod: payload.paymentMethod,
    paymentDate,
    nextPaymentDate: finalNextPaymentDate,
    status: computePaymentStatus(settlement.dueAmount, paidTotal),
    source: "MANUAL",
    metadata: {
      entryKind: "collect_bill",
      collectionMode: payload.collectionMode,
      currentDueAmountBeforeCollection: openingDueAmount,
      currentAdvanceAmountBeforeCollection: openingAdvanceAmount,
      overdueMonthsApplied: dueLedger.items.filter((item) => item.type === "monthly_due").length,
      accruedAmountApplied: normalizeMoney(
        dueLedger.items
          .filter((item) => item.type === "monthly_due")
          .reduce((total, item) => total + item.remainingAmount, 0),
      ),
      selectedDueAmount,
      effectiveDuePaymentAmount,
      cycleChargeAmount: cycleDetails.cycleCharge,
      invoiceLineItems: resolvedInvoiceLines.map((line) => ({
        key: line.key,
        kind: line.kind,
        lineType: line.lineType,
        label: line.label,
        amount: line.amount,
        ledgerItemId: line.ledgerItemId,
        dueDate: line.dueDate,
        periodStart: line.periodStart,
        periodEnd: line.periodEnd,
        packageId: line.packageId,
        packageName: line.packageName,
        paidMonths: line.paidMonths,
        advanceAppliedAmount: line.advanceAppliedAmount,
        discountAppliedAmount: line.discountAppliedAmount,
        paidAppliedAmount: line.paidAppliedAmount,
        resolvedAmount: line.resolvedAmount,
        unresolvedAmount: line.unresolvedAmount,
      })),
      remainingDueAmount: finalBalanceSnapshot.currentDueAmount,
      remainingAdvanceAmount: finalBalanceSnapshot.currentAdvanceAmount,
      previousNextPaymentDate: member.nextPaymentDate,
      newNextPaymentDate: finalNextPaymentDate,
      reactivatedMember:
        member.isActive === false && payload.collectionMode !== "due_only",
      note: payload.note,
    },
  };

  const payment = await persistCollectedBill(
    String(member._id),
    paymentData,
    memberUpdatePayload,
  );

  await invalidateMemberBillingCaches(branchId, String(member._id));

  const updatedMember = await MemberRepository.findById(String(member._id));

  if (!updatedMember) {
    throw new AppError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      "Member update completed but the latest member record could not be loaded",
    );
  }

  return {
    payment,
    member: updatedMember,
    billing: {
      currentDueAmount: updatedMember.currentDueAmount ?? 0,
      currentAdvanceAmount: updatedMember.currentAdvanceAmount ?? 0,
      nextPaymentDate: updatedMember.nextPaymentDate,
      monthlyFeeAmount: resolveMemberMonthlyFeeAmount(updatedMember, branch),
      overdueMonths: updatedDueLedger.items.filter(
        (item) => item.type === "monthly_due",
      ).length,
      effectiveDuePaymentAmount,
    },
  };
};

const getAllPayments = async (
  branchId: string,
  actor: TAccessActor,
  query: TQueryPayment,
) => {
  await resolveBranchAccess(branchId, actor);

  const normalizedQuery: Record<string, unknown> = { ...query };

  if (query.memberId && Types.ObjectId.isValid(query.memberId)) {
    normalizedQuery.memberId = new Types.ObjectId(query.memberId);
  }

  if (query.packageId && Types.ObjectId.isValid(query.packageId)) {
    normalizedQuery.packageId = new Types.ObjectId(query.packageId);
  }

  const paymentQuery = new QueryBuilder(
    PaymentRepository.findMany({ branchId: new Types.ObjectId(branchId) }),
    normalizedQuery,
  )
    .search(["invoiceNo", "memberName", "packageName"])
    .filter()
    .sort()
    .paginate()
    .fields();

  const result = await paymentQuery.modelQuery;
  const meta = await paymentQuery.countTotal();

  return {
    meta,
    result,
  };
};

const getPaymentById = async (
  branchId: string,
  paymentId: string,
  actor: TAccessActor,
) => {
  await resolveBranchAccess(branchId, actor);

  const payment = await PaymentRepository.findOne({
    _id: new Types.ObjectId(paymentId),
    branchId: new Types.ObjectId(branchId),
  });

  if (!payment) {
    throw new AppError(StatusCodes.NOT_FOUND, "Payment not found");
  }

  return payment;
};

const updatePayment = async (
  branchId: string,
  paymentId: string,
  actor: TAccessActor,
  payload: TUpdatePaymentPayload,
) => {
  await resolveBranchAccess(branchId, actor);

  const existingPayment = await PaymentRepository.findOne({
    _id: new Types.ObjectId(paymentId),
    branchId: new Types.ObjectId(branchId),
  });

  if (!existingPayment) {
    throw new AppError(StatusCodes.NOT_FOUND, "Payment not found");
  }
  const oldNetEffect = getPaymentNetEffect(existingPayment);

  // Recalculate due amount and status if financial fields are updated
  let updatedPayload = { ...payload };

  const subTotal = payload.subTotal ?? existingPayment.subTotal ?? 0;
  const paidTotal = payload.paidTotal ?? existingPayment.paidTotal ?? 0;
  const discount = payload.discount ?? existingPayment.discount ?? 0;

  if (
    payload.subTotal !== undefined ||
    payload.paidTotal !== undefined ||
    payload.discount !== undefined ||
    payload.dueAmount !== undefined ||
    payload.advanceAmount !== undefined
  ) {
    const settlement = computePaymentSettlement({
      subTotal,
      paidTotal,
      discount,
    });
    const status = payload.status ?? computePaymentStatus(settlement.dueAmount, paidTotal);

    updatedPayload = {
      ...updatedPayload,
      dueAmount: settlement.dueAmount,
      advanceAmount: settlement.advanceAmount,
      status,
    };
  }

  const updatedPayment = await PaymentRepository.updateById(paymentId, updatedPayload);

  if (!updatedPayment) {
    throw new AppError(StatusCodes.INTERNAL_SERVER_ERROR, "Failed to update payment");
  }

  // Sync member's currentDueAmount when the due amount changes
  const newNetEffect = getPaymentNetEffect(updatedPayment);
  const netEffectDiff = normalizeMoney(newNetEffect - oldNetEffect);

  if (netEffectDiff !== 0 && existingPayment.memberId) {
    await syncMemberBalanceDelta(
      branchId,
      existingPayment.memberId.toString(),
      netEffectDiff,
    );
  }

  return updatedPayment;
};

const cancelPayment = async (
  branchId: string,
  paymentId: string,
  actor: TAccessActor,
) => {
  await resolveBranchAccess(branchId, actor);

  const existingPayment = await PaymentRepository.findOne({
    _id: new Types.ObjectId(paymentId),
    branchId: new Types.ObjectId(branchId),
  });

  if (!existingPayment) {
    throw new AppError(StatusCodes.NOT_FOUND, "Payment not found");
  }

  if (existingPayment.status === PaymentStatus.CANCELLED) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Payment is already cancelled");
  }

  const cancelledPayment = await PaymentRepository.updateById(paymentId, {
    status: PaymentStatus.CANCELLED,
  });

  if (existingPayment.memberId) {
    await syncMemberBalanceDelta(
      branchId,
      existingPayment.memberId.toString(),
      normalizeMoney(-getPaymentNetEffect(existingPayment)),
    );
  }

  return cancelledPayment;
};

const refundPayment = async (
  branchId: string,
  paymentId: string,
  actor: TAccessActor,
) => {
  await resolveBranchAccess(branchId, actor);

  const existingPayment = await PaymentRepository.findOne({
    _id: new Types.ObjectId(paymentId),
    branchId: new Types.ObjectId(branchId),
  });

  if (!existingPayment) {
    throw new AppError(StatusCodes.NOT_FOUND, "Payment not found");
  }

  if (existingPayment.status === PaymentStatus.REFUNDED) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Payment is already refunded");
  }

  if (existingPayment.status === PaymentStatus.CANCELLED) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Cannot refund a cancelled payment");
  }

  const refundedPayment = await PaymentRepository.updateById(paymentId, {
    status: PaymentStatus.REFUNDED,
  });

  if (existingPayment.memberId) {
    await syncMemberBalanceDelta(
      branchId,
      existingPayment.memberId.toString(),
      normalizeMoney(-getPaymentNetEffect(existingPayment)),
    );
  }

  return refundedPayment;
};

export const PaymentService = {
  createPayment,
  getCollectBillContext,
  collectBill,
  getAllPayments,
  getPaymentById,
  updatePayment,
  cancelPayment,
  refundPayment,
};
