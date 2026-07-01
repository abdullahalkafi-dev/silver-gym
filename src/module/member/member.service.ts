import { StatusCodes } from "http-status-codes";
import mongoose, { Types } from "mongoose";

import { QueryBuilder } from "../../Builder/QueryBuilder";
import AppError from "../../errors/AppError";
import cacheService from "../../redis-client/cacheService";
import unlinkFile from "../../shared/unlinkFile";
import { storage } from "../../shared/storage";
import { BranchRepository } from "../branch/branch.repository";
import { BranchService } from "../branch/branch.service";
import { BusinessProfileRepository } from "../businessProfile/businessProfile.repository";
import { PackageDurationType } from "../package/package.interface";
import { PackageRepository } from "../package/package.repository";
import {
  PaymentStatus,
  PaymentType,
  TPayment,
} from "../payment/payment.interface";
import {
  computePaymentSettlement,
  isDateWithinCurrentOrNextMonth,
  isFirstDayOfCalendarMonth,
  isMonthWithinCurrentOrNextMonth,
  normalizeMoney,
  startOfCalendarMonth,
} from "../payment/payment.balance";
import { PaymentRepository } from "../payment/payment.repository";
import { InvoiceCounterService } from "../payment/invoiceCounter.service";
import { TStaff } from "../staff/staff.interface";
import {
  applyBillingToMember,
  buildMemberBillingUpdate,
  mergeMemberBillingProfileMetadata,
  reconcileMemberBillingState,
  resolveReactivatedNextPaymentDate,
} from "./member.billing";
import {
  createAdmissionDueLedgerItem,
  hasMemberBillingLedgerChanged,
  mergeMemberBillingLedgerMetadata,
  reconcileMemberBillingLedger,
  resolvePrimaryDueType,
  sumMemberBillingLedger,
} from "./member.billingLedger";
import { TMember } from "./member.interface";
import { MemberRepository } from "./member.repository";
import { MemberCounterService } from "./memberCounter.service";

type TCreatePaymentPayload = {
  paymentMethod: TPayment["paymentMethod"];
  paidTotal: number;
  discount?: number;
  admissionFee?: number;
  paymentDate?: Date;
  status?: PaymentStatus;
};

type TCreateMemberPayload = Omit<
  TMember,
  | "branchId"
  | "photo"
  | "currentPackageId"
  | "customMonthlyFeeAmount"
  | "currentDueAmount"
  | "createdAt"
  | "updatedAt"
> & {
  currentPackageId?: string;
  customMonthlyFeeAmount?: number;
  payment: TCreatePaymentPayload;
};

type TUpdateMemberPayload = Partial<
  Omit<
    TMember,
    | "branchId"
    | "photo"
    | "currentPackageId"
    | "customMonthlyFeeAmount"
    | "currentDueAmount"
    | "createdAt"
    | "updatedAt"
  >
> & {
  currentPackageId?: string;
  customMonthlyFeeAmount?: number;
};

type TAccessActor = {
  userId?: Types.ObjectId;
  staff?: TStaff;
};

type TDashboardSummaryQuery = {
  days?: unknown;
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
    default:
      nextDate.setDate(nextDate.getDate() + duration);
      break;
  }

  return nextDate;
};

const addMonths = (date: Date, months: number): Date => {
  const nextDate = new Date(date);
  const day = nextDate.getDate();
  nextDate.setMonth(nextDate.getMonth() + months);
  if (nextDate.getDate() !== day) {
    nextDate.setDate(0);
  }
  return nextDate;
};

const assertMonthBasedNewMemberStartDate = (
  membershipStartDate: Date,
  subject: string,
) => {
  if (
    !isFirstDayOfCalendarMonth(membershipStartDate) ||
    !isMonthWithinCurrentOrNextMonth(membershipStartDate)
  ) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      `${subject} must start on the first day of the current month or next month`,
    );
  }
};

const assertFlexibleNewMemberStartDate = (
  membershipStartDate: Date,
  subject: string,
) => {
  if (!isDateWithinCurrentOrNextMonth(membershipStartDate)) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      `${subject} must start within the current month or next month`,
    );
  }
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

const BRANCH_BILLING_RECONCILE_TTL_SECONDS = 60;

const getBillingReconcileCacheKey = (branchId: string) =>
  `members:${branchId}:billing-reconciled`;

/**
 * Convert a Mongoose document to a plain object so that spreading it does not
 * leak internal Mongoose properties ($__, _doc, $isNew, etc.) into the
 * response payload.  When the value is already a plain object (e.g. coming
 * from the Redis cache) it is returned as-is.
 */
const toPlainMember = (
  doc: TMember & { _id?: unknown },
): TMember & { _id?: unknown } => {
  const raw = doc as unknown as Record<string, unknown>;
  if (typeof raw.toObject === "function") {
    return (raw.toObject as () => TMember & { _id?: unknown })();
  }
  return doc;
};

const reconcileMemberRecord = async (
  branchId: string,
  branch: Awaited<ReturnType<typeof BranchRepository.findOne>>,
  member: TMember & { _id?: unknown },
) => {
  if (!branch) {
    return member;
  }

  // Ensure we work with a plain object — Mongoose documents serialise poorly
  // when spread (their schema-field getters are not own-enumerable properties
  // so `{ ...doc }` copies $__, _doc, $isNew instead of fullName, contact, …)
  const memberPlain = toPlainMember(member);

  const billing = reconcileMemberBillingState(memberPlain, branch);
  const dueLedger = reconcileMemberBillingLedger(memberPlain, billing);
  const shouldPersistLedger = hasMemberBillingLedgerChanged(
    memberPlain.metadata,
    dueLedger,
  );

  if ((!billing.shouldPersist && !shouldPersistLedger) || !memberPlain._id) {
    return {
      ...applyBillingToMember(memberPlain, billing),
      metadata: mergeMemberBillingLedgerMetadata(memberPlain.metadata, dueLedger),
    };
  }

  const updatedMember = await MemberRepository.updateById(
    String(memberPlain._id),
    {
      currentDueAmount: sumMemberBillingLedger(dueLedger.items),
      metadata: mergeMemberBillingLedgerMetadata(memberPlain.metadata, dueLedger),
    },
  );

  await Promise.all([
    cacheService.deleteCache(`members:${branchId}:${String(memberPlain._id)}`),
    cacheService.deleteCache(getBillingReconcileCacheKey(branchId)),
    cacheService.invalidateByPattern(`members:${branchId}:list:*`),
  ]);

  // updatedMember is a Mongoose document — convert it too so the return value
  // is always a plain object regardless of which code path was taken.
  const updatedPlain = updatedMember
    ? toPlainMember(updatedMember as unknown as TMember & { _id?: unknown })
    : undefined;

  return updatedPlain ?? applyBillingToMember(memberPlain, billing);
};

const reconcileBranchMemberBilling = async (
  branchId: string,
  branch: Awaited<ReturnType<typeof BranchRepository.findOne>>,
) => {
  if (!branch) {
    return;
  }

  const reconcileCacheKey = getBillingReconcileCacheKey(branchId);
  const alreadyReconciled = await cacheService.getCache<{ at: number }>(
    reconcileCacheKey,
  );

  if (alreadyReconciled) {
    return;
  }

  const overdueCutoff = startOfCalendarMonth(new Date());

  const overdueMembers = await MemberRepository.findMany(
    {
      branchId: new Types.ObjectId(branchId),
      isActive: true,
      nextPaymentDate: { $lte: overdueCutoff },
    },
    {
      select:
        "currentDueAmount nextPaymentDate isActive isCustomMonthlyFee customMonthlyFeeAmount metadata _id",
    },
  ).lean();

  const changedMemberIds = (
    await Promise.all(
      overdueMembers.map(async (member) => {
        const billing = reconcileMemberBillingState(member as TMember, branch);
        const dueLedger = reconcileMemberBillingLedger(member as TMember, billing);
        const shouldPersistLedger = hasMemberBillingLedgerChanged(
          (member as TMember).metadata,
          dueLedger,
        );

        if ((!billing.shouldPersist && !shouldPersistLedger) || !member._id) {
          return null;
        }

        await MemberRepository.updateById(
          String(member._id),
          {
            currentDueAmount: sumMemberBillingLedger(dueLedger.items),
            metadata: mergeMemberBillingLedgerMetadata(
              (member as TMember).metadata,
              dueLedger,
            ),
          },
        );

        return String(member._id);
      }),
    )
  ).filter((memberId): memberId is string => Boolean(memberId));

  if (changedMemberIds.length > 0) {
    const BATCH_SIZE = 50;
    for (let i = 0; i < changedMemberIds.length; i += BATCH_SIZE) {
      const batch = changedMemberIds.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map((memberId) =>
          cacheService.deleteCache(`members:${branchId}:${memberId}`),
        ),
      );
    }
    await cacheService.invalidateByPattern(`members:${branchId}:list:*`);
  }

  await cacheService.setCache(
    reconcileCacheKey,
    { at: Date.now() },
    BRANCH_BILLING_RECONCILE_TTL_SECONDS,
  );
};

const resolveBranchAccess = async (
  branchId: string,
  actor: TAccessActor,
  photoFile?: Express.Multer.File,
) => {
  const branch = await BranchRepository.findOne({
    _id: new Types.ObjectId(branchId),
    isActive: true,
  });

  if (!branch) {
    if (photoFile) {
      await unlinkFile(storage.getObjectKey(photoFile.path));
    }

    throw new AppError(StatusCodes.NOT_FOUND, "Branch not found");
  }

  if (actor.userId) {
    const business = await BusinessProfileRepository.findOne({
      _id: branch.businessId,
      userId: actor.userId,
    });

    if (!business) {
      if (photoFile) {
        await unlinkFile(storage.getObjectKey(photoFile.path));
      }

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

const createMemberAndPayment = async (
  memberData: TMember,
  paymentData: Omit<TPayment, "memberId" | "memberName">,
) => {
  let session: mongoose.ClientSession | null = null;

  try {
    session = await mongoose.startSession();
    session.startTransaction();

    const member = await MemberRepository.create(memberData, { session });
    const payment = await PaymentRepository.create(
      {
        ...paymentData,
        memberId: member._id as Types.ObjectId,
        memberName: member.fullName,
      },
      { session },
    );

    await session.commitTransaction();

    return { member, payment };
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

  const member = await MemberRepository.create(memberData);

  try {
    const payment = await PaymentRepository.create({
      ...paymentData,
      memberId: member._id as Types.ObjectId,
      memberName: member.fullName,
    });

    return { member, payment };
  } catch (error) {
    const failedAt = new Date();
    try {
      await MemberRepository.updateById(String(member._id), {
        isActive: false,
        metadata: {
          ...mergeMemberBillingProfileMetadata(member.metadata, {
            accrualStoppedAt: failedAt.toISOString(),
          }),
          paymentConsistencyIssue: true,
        },
      });
    } catch {
      // If marking member as inactive also fails, log but continue
    }

    throw new AppError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      "Payment creation failed. Member moved to inactive state",
    );
  }
};

const createMember = async (
  branchId: string,
  actor: TAccessActor,
  payload: TCreateMemberPayload,
  photoFile?: Express.Multer.File,
) => {
  const branch = await resolveBranchAccess(branchId, actor, photoFile);
  BranchService.ensureBranchFeesConfigured(branch, "member");

  const membershipStartDate = payload.membershipStartDate
    ? new Date(payload.membershipStartDate)
    : new Date();

  const paymentInput = payload.payment;
  let currentPackageId: Types.ObjectId | undefined;
  let currentPackageName: string | undefined;
  let membershipEndDate: Date | undefined;
  let nextPaymentDate: Date | undefined;
  let packageDuration: number | undefined;
  let packageDurationType: string | undefined;
  let packageIdForPayment: Types.ObjectId | undefined;
  let paymentType: PaymentType;
  let periodEnd: Date;
  let subTotal = 0;
  let resolvedMonthlyFeeAmount: number | undefined;
  let paidMonthsForPayment: number | undefined;
  let resolvedAdmissionFeeAmount: number | undefined;

  if (payload.currentPackageId) {
    const packageDoc = await PackageRepository.findOne({
      _id: new Types.ObjectId(payload.currentPackageId),
      branchId: new Types.ObjectId(branchId),
      isActive: true,
    });

    if (!packageDoc) {
      if (photoFile) {
        await unlinkFile(storage.getObjectKey(photoFile.path));
      }

      throw new AppError(StatusCodes.NOT_FOUND, "Package not found for this branch");
    }

    currentPackageId = packageDoc._id as Types.ObjectId;
    currentPackageName = packageDoc.title;
    packageDuration = packageDoc.duration;
    packageDurationType = packageDoc.durationType;
    packageIdForPayment = packageDoc._id as Types.ObjectId;

    try {
      if (packageDoc.durationType === PackageDurationType.MONTH) {
        assertMonthBasedNewMemberStartDate(
          membershipStartDate,
          "Month-based packages",
        );
      } else {
        assertFlexibleNewMemberStartDate(membershipStartDate, "Packages");
      }
    } catch (error) {
      if (photoFile) {
        await unlinkFile(storage.getObjectKey(photoFile.path));
      }

      throw error;
    }

    membershipEndDate = addDuration(
      membershipStartDate,
      packageDoc.duration,
      packageDoc.durationType,
    );
    periodEnd = membershipEndDate;
    nextPaymentDate = membershipEndDate;
    paymentType = PaymentType.PACKAGE;
    paidMonthsForPayment = undefined;
    resolvedAdmissionFeeAmount =
      packageDoc.includeAdmissionFee && typeof branch.admissionFeeAmount === "number"
        ? branch.admissionFeeAmount
        : undefined;

    subTotal = packageDoc.amount + (resolvedAdmissionFeeAmount ?? 0);
  } else {
    // Monthly billing mode: triggered when no package is provided + paidMonths given
    try {
      assertMonthBasedNewMemberStartDate(
        membershipStartDate,
        "Monthly memberships",
      );
    } catch (error) {
      if (photoFile) {
        await unlinkFile(storage.getObjectKey(photoFile.path));
      }

      throw error;
    }

    const monthlyFeeFromPayload =
      typeof payload.customMonthlyFeeAmount === "number" ? payload.customMonthlyFeeAmount : undefined;
    const monthlyFeeFromBranch =
      typeof branch.monthlyFeeAmount === "number" ? branch.monthlyFeeAmount : undefined;

    resolvedMonthlyFeeAmount = monthlyFeeFromPayload ?? monthlyFeeFromBranch;

    if (resolvedMonthlyFeeAmount == null) {
      if (photoFile) {
        await unlinkFile(storage.getObjectKey(photoFile.path));
      }

      throw new AppError(
        StatusCodes.BAD_REQUEST,
        "Monthly fee is required. Set customMonthlyFeeAmount or configure branch monthly fee",
      );
    }

    const paidMonths = payload.paidMonths && payload.paidMonths > 0 ? payload.paidMonths : 1;
    paidMonthsForPayment = paidMonths;
    periodEnd = addMonths(membershipStartDate, paidMonths);
    nextPaymentDate = periodEnd;
    paymentType = PaymentType.MONTHLY;
    resolvedAdmissionFeeAmount = paymentInput.admissionFee;
    subTotal = resolvedMonthlyFeeAmount * paidMonths + (resolvedAdmissionFeeAmount ?? 0);
  }

  const discount = paymentInput.discount ?? 0;
  const paidTotal = paymentInput.paidTotal ?? 0;
  const settlement = computePaymentSettlement({
    subTotal,
    paidTotal,
    discount,
  });

  // Overpayment is allowed — excess is stored as 'exchange' (change given back to member)
  const exchangeAmount = normalizeMoney(settlement.overpaidAmount);
  const billAmount = normalizeMoney(Math.max(0, subTotal - discount));

  const memberPayload = {
    ...payload,
  } as Omit<TCreateMemberPayload, "payment" | "currentPackageId" | "customMonthlyFeeAmount"> & {
    customMonthlyFeeAmount?: number;
  };

  delete (memberPayload as Record<string, unknown>).payment;
  delete (memberPayload as Record<string, unknown>).currentPackageId;

  if (payload.isCustomMonthlyFee && payload.customMonthlyFeeAmount != null) {
    // Package member with a pre-stored custom monthly rate, OR monthly member with custom rate.
    memberPayload.isCustomMonthlyFee = true;
    memberPayload.customMonthlyFeeAmount = payload.customMonthlyFeeAmount;
  } else if (!payload.currentPackageId) {
    // Monthly billing with no custom rate override — rate resolved from branch at billing time
    memberPayload.isCustomMonthlyFee = false;
    delete (memberPayload as Record<string, unknown>).customMonthlyFeeAmount;
  } else {
    // Package-only member, no custom fee configured yet
    delete (memberPayload as Record<string, unknown>).customMonthlyFeeAmount;
  }

  const now = new Date();
  const baseBillingMetadata = mergeMemberBillingProfileMetadata(
    (memberPayload as Record<string, unknown>).metadata ?? {},
    {
      cycleType: payload.currentPackageId ? "package" : "monthly",
      accrualStoppedAt: undefined,
      recurringMonthlyFeeAmount: payload.currentPackageId
        ? typeof memberPayload.customMonthlyFeeAmount === "number" &&
          memberPayload.customMonthlyFeeAmount > 0
          ? memberPayload.customMonthlyFeeAmount
          : undefined
        : resolvedMonthlyFeeAmount,
    },
  );

  const admissionDueLedgerMetadata =
    settlement.dueAmount > 0
      ? mergeMemberBillingLedgerMetadata(
          baseBillingMetadata,
          {
            version: 1,
            items: [createAdmissionDueLedgerItem(settlement.dueAmount, now)],
            updatedAt: now.toISOString(),
          },
        )
      : baseBillingMetadata;

  const memberData: TMember = {
    ...memberPayload,
    branchId: new Types.ObjectId(branchId),
    currentPackageId,
    currentPackageName,
    membershipStartDate,
    membershipEndDate,
    nextPaymentDate,
    currentDueAmount: settlement.dueAmount,
    isActive: true,
    source: payload.source || "app",
    photo: photoFile ? storage.getObjectKey(photoFile.path) : undefined,
    ...(admissionDueLedgerMetadata ? { metadata: admissionDueLedgerMetadata } : {}),
  };

  // Assign auto-incrementing systemMemberId (per-branch, atomic)
  memberData.systemMemberId = await MemberCounterService.getNextSystemMemberId(branchId);

  const paymentData: Omit<TPayment, "memberId" | "memberName"> = {
    branchId: new Types.ObjectId(branchId),
    invoiceNo: `PAY-${String(await InvoiceCounterService.getNextInvoiceSequence("PAYMENT")).padStart(12, "0")}`,
    packageId: packageIdForPayment,
    packageName: currentPackageName,
    packageDuration,
    packageDurationType,
    paymentType,
    periodStart: membershipStartDate,
    periodEnd,
    paidMonths: paidMonthsForPayment,
    year: membershipStartDate.getFullYear(),
    subTotal,
    discount,
    billAmount,
    dueAmount: settlement.dueAmount,
    paidTotal,
    admissionFee: resolvedAdmissionFeeAmount,
    paymentMethod: paymentInput.paymentMethod,
    paymentDate: paymentInput.paymentDate || new Date(),
    nextPaymentDate,
    status: computePaymentStatus(settlement.dueAmount, paidTotal, paymentInput.status),
    exchange: exchangeAmount > 0 ? exchangeAmount : undefined,
    source: payload.source || "app",
  };

  try {
    const result = await createMemberAndPayment(memberData, paymentData);
    await Promise.all([
      cacheService.invalidateByPattern(`members:${branchId}:list:*`),
      cacheService.invalidateByPattern(`analytics:${branchId}:*`),
    ]);
    return result;
  } catch (error) {
    const dbError = error as { code?: number; keyValue?: Record<string, unknown> };
    if (dbError?.code === 11000 && dbError?.keyValue) {
      const field = Object.keys(dbError.keyValue)[0] ?? "";
      if (field.includes("contact")) {
        throw new AppError(
          StatusCodes.CONFLICT,
          "A member with this phone number already exists in this branch.",
        );
      }
      if (field.includes("barcode")) {
        throw new AppError(
          StatusCodes.CONFLICT,
          "A member with this barcode already exists in this branch.",
        );
      }
      if (field.includes("systemMemberId")) {
        throw new AppError(
          StatusCodes.CONFLICT,
          "Member ID conflict. Please try again.",
        );
      }
    }
    throw error;
  }
};

const getMembers = async (
  branchId: string,
  actor: TAccessActor,
  query: Record<string, unknown>,
) => {
  const branch = await resolveBranchAccess(branchId, actor);

  const includeInactive =
    typeof query.includeInactive === "string" && query.includeInactive === "true";
  const requestedIsActive =
    typeof query.isActive === "string" && ["true", "false"].includes(query.isActive)
      ? query.isActive === "true"
      : undefined;
  const paymentStatus =
    query.paymentStatus === "due" ||
    query.paymentStatus === "complete" ||
    query.paymentStatus === "monthly_due" ||
    query.paymentStatus === "admission_due"
      ? query.paymentStatus
      : undefined;

  const billingPlan =
    query.billingPlan === "custom" || query.billingPlan === "system"
      ? query.billingPlan
      : undefined;

  const sanitizedQuery = { ...query };
  delete sanitizedQuery.includeInactive;
  delete sanitizedQuery.isActive;
  delete sanitizedQuery.paymentStatus;
  delete sanitizedQuery.billingPlan;
  delete sanitizedQuery.sort;

  await reconcileBranchMemberBilling(branchId, branch);

  const baseFilter: Record<string, unknown> = {
    branchId: new Types.ObjectId(branchId),
  };

  if (typeof requestedIsActive === "boolean") {
    baseFilter.isActive = requestedIsActive;
  } else if (!includeInactive) {
    baseFilter.isActive = true;
  }

  if (paymentStatus === "monthly_due") {
    baseFilter.currentDueAmount = { $gt: 0 };
    baseFilter["metadata.billingDueLedger.items"] = {
      $elemMatch: {
        type: { $in: ["monthly_due", "monthly_cycle_due"] },
        remainingAmount: { $gt: 0 },
      },
    };
  } else if (paymentStatus === "admission_due") {
    baseFilter.currentDueAmount = { $gt: 0 };
    baseFilter["metadata.billingDueLedger.items"] = {
      $elemMatch: {
        type: "admission_due",
        remainingAmount: { $gt: 0 },
      },
    };
  } else if (paymentStatus === "due") {
    baseFilter.currentDueAmount = { $gt: 0 };
  } else if (paymentStatus === "complete") {
    baseFilter.currentDueAmount = { $lte: 0 };
  }

  if (billingPlan === "custom") {
    baseFilter.isCustomMonthlyFee = true;
  } else if (billingPlan === "system") {
    baseFilter.isCustomMonthlyFee = { $ne: true };
  }

  const cacheKey = `members:${branchId}:list:${JSON.stringify(Object.entries(query).sort())}`;
  const cached = await cacheService.getCache<{ meta: unknown; data: unknown }>(cacheKey);
  if (cached) return cached;

  const queryBuilder = new QueryBuilder<TMember>(
    MemberRepository.findMany(baseFilter),
    sanitizedQuery,
    {
      filterableTextFields: ["fullName", "email", "contact", "memberId", "barcode"],
      allowedSortFields: ["fullName", "createdAt", "nextPaymentDate", "membershipStartDate"],
    },
  );

  if (query.searchTerm) {
    const isObjectId = Types.ObjectId.isValid(query.searchTerm as string) &&
      String(new Types.ObjectId(query.searchTerm as string)) === query.searchTerm;
    if (isObjectId) {
      queryBuilder.modelQuery = queryBuilder.modelQuery.find({
        $or: [
          { _id: new Types.ObjectId(query.searchTerm as string) },
          ...["fullName", "email", "contact", "memberId", "barcode"].map((field) => ({
            [field]: new RegExp((query.searchTerm as string).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
          })),
        ],
      });
    } else {
      queryBuilder.search(["fullName", "email", "contact", "memberId", "barcode"]);
    }
  }

  queryBuilder.filter().sort().paginate();

  const data = await queryBuilder.modelQuery.lean();
  const meta = await queryBuilder.countTotal();

  const enrichedData = data.map((member) => ({
    ...member,
    primaryDueType: resolvePrimaryDueType({
      currentDueAmount: (member as Record<string, unknown>).currentDueAmount as number | undefined,
      metadata: (member as Record<string, unknown>).metadata,
    }),
  }));

  const result = { meta, data: enrichedData };
  await cacheService.setCache(cacheKey, result, 300);
  return result;
};

const getMemberById = async (
  branchId: string,
  memberId: string,
  actor: TAccessActor,
  includeInactive = true,
) => {
  const branch = await resolveBranchAccess(branchId, actor);

  const cacheKey = `members:${branchId}:${memberId}`;
  const cached = await cacheService.getCache<TMember>(cacheKey);
  if (cached) {
    const reconciledCachedMember = await reconcileMemberRecord(branchId, branch, cached);
    await cacheService.setCache(cacheKey, reconciledCachedMember, 600);
    return reconciledCachedMember;
  }

  const member = await MemberRepository.findOne({
    _id: new Types.ObjectId(memberId),
    branchId: new Types.ObjectId(branchId),
    ...(includeInactive ? {} : { isActive: true }),
  });

  if (!member) {
    throw new AppError(StatusCodes.NOT_FOUND, "Member not found");
  }

  const reconciledMember = await reconcileMemberRecord(branchId, branch, member);
  await cacheService.setCache(cacheKey, reconciledMember, 600);
  return reconciledMember;
};

const updateMember = async (
  branchId: string,
  memberId: string,
  actor: TAccessActor,
  payload: TUpdateMemberPayload,
  photoFile?: Express.Multer.File,
) => {
  const branch = await resolveBranchAccess(branchId, actor, photoFile);

  const member = await MemberRepository.findOne({
    _id: new Types.ObjectId(memberId),
    branchId: new Types.ObjectId(branchId),
  });

  if (!member) {
    if (photoFile) {
      await unlinkFile(storage.getObjectKey(photoFile.path));
    }

    throw new AppError(StatusCodes.NOT_FOUND, "Member not found");
  }

  // ─── DUPLICATE CONTACT CHECK ──────────────────────────────────────────────
  if (
    typeof payload.contact === "string" &&
    payload.contact.trim() &&
    payload.contact !== member.contact
  ) {
    const existingMember = await MemberRepository.findOne({
      branchId: new Types.ObjectId(branchId),
      contact: payload.contact,
      _id: { $ne: new Types.ObjectId(memberId) },
    });

    if (existingMember) {
      if (photoFile) {
        await unlinkFile(storage.getObjectKey(photoFile.path));
      }

      throw new AppError(
        StatusCodes.CONFLICT,
        "This phone number already exists in this branch",
      );
    }
  }

  const updatePayload: Record<string, unknown> = {
    ...payload,
  };
  let nextMetadata: unknown = Object.prototype.hasOwnProperty.call(
    updatePayload,
    "metadata",
  )
    ? updatePayload.metadata
    : member.metadata;

  const unsetPayload: Record<string, 1> = {};
  const branchMonthlyFeeAmount =
    typeof branch.monthlyFeeAmount === "number" ? branch.monthlyFeeAmount : undefined;

  // ─── PACKAGE UPDATE BRANCH ──────────────────────────────────────────────────
  if (payload.currentPackageId) {
    const packageDoc = await PackageRepository.findOne({
      _id: new Types.ObjectId(payload.currentPackageId),
      branchId: new Types.ObjectId(branchId),
      isActive: true,
    });

    if (!packageDoc) {
      if (photoFile) {
        await unlinkFile(storage.getObjectKey(photoFile.path));
      }

      throw new AppError(StatusCodes.NOT_FOUND, "Package not found for this branch");
    }

    const membershipStartDate = payload.membershipStartDate
      ? new Date(payload.membershipStartDate)
      : member.membershipStartDate || new Date();

    updatePayload.currentPackageId = packageDoc._id as Types.ObjectId;
    updatePayload.currentPackageName = packageDoc.title;
    // NOTE: do NOT touch isCustomMonthlyFee / customMonthlyFeeAmount — they
    // store the member's personal rate that will apply after the package ends.
    updatePayload.membershipStartDate = membershipStartDate;
    updatePayload.membershipEndDate = addDuration(
      membershipStartDate,
      packageDoc.duration,
      packageDoc.durationType,
    );
    updatePayload.nextPaymentDate = updatePayload.membershipEndDate;
    nextMetadata = mergeMemberBillingProfileMetadata(nextMetadata, {
      cycleType: "package",
    });
  }

  // ─── VALIDATION: standalone customMonthlyFeeAmount requires isCustomMonthlyFee ─
  if (
    typeof payload.customMonthlyFeeAmount === "number" &&
    payload.isCustomMonthlyFee !== true &&
    member.isCustomMonthlyFee !== true
  ) {
    if (photoFile) {
      await unlinkFile(storage.getObjectKey(photoFile.path));
    }

    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "customMonthlyFeeAmount can only be set when isCustomMonthlyFee is true",
    );
  }

  // ─── RESET CUSTOM FEE: when isCustomMonthlyFee is set to false ─────────────
  if (
    payload.isCustomMonthlyFee === false &&
    member.isCustomMonthlyFee === true
  ) {
    unsetPayload.customMonthlyFeeAmount = 1;
    nextMetadata = mergeMemberBillingProfileMetadata(nextMetadata, {
      recurringMonthlyFeeAmount: undefined,
    });
  }

  // ─── MONTHLY BILLING TRANSITION ─────────────────────────────────────────────
  // Triggered when paidMonths is provided and no package is being assigned.
  const isSwitchingToMonthly =
    typeof payload.paidMonths === "number" &&
    payload.paidMonths > 0 &&
    !payload.currentPackageId;

  if (isSwitchingToMonthly) {
    // Fee resolution priority: new customMonthlyFeeAmount in payload → stored member rate → branch default
    const resolvedMonthlyFeeAmount =
      (typeof payload.customMonthlyFeeAmount === "number" ? payload.customMonthlyFeeAmount : undefined) ??
      (member.isCustomMonthlyFee && typeof member.customMonthlyFeeAmount === "number"
        ? member.customMonthlyFeeAmount
        : undefined) ??
      branchMonthlyFeeAmount;

    if (resolvedMonthlyFeeAmount == null) {
      if (photoFile) {
        await unlinkFile(storage.getObjectKey(photoFile.path));
      }

      throw new AppError(
        StatusCodes.BAD_REQUEST,
        "Monthly fee is required. Set customMonthlyFeeAmount or configure branch monthly fee",
      );
    }

    const membershipStartDate = payload.membershipStartDate
      ? new Date(payload.membershipStartDate)
      : member.membershipStartDate || new Date();

    const paidMonths = Number(payload.paidMonths);

    updatePayload.membershipStartDate = membershipStartDate;
    updatePayload.paidMonths = paidMonths;
    updatePayload.nextPaymentDate = addMonths(membershipStartDate, paidMonths);
    // If the member had a custom rate, preserve/update it on the stored field
    if (member.isCustomMonthlyFee || payload.isCustomMonthlyFee) {
      updatePayload.isCustomMonthlyFee = true;
      updatePayload.customMonthlyFeeAmount = resolvedMonthlyFeeAmount;
    }

    // Clear package fields when transitioning to monthly billing
    unsetPayload.currentPackageId = 1;
    unsetPayload.currentPackageName = 1;
    unsetPayload.membershipEndDate = 1;
    nextMetadata = mergeMemberBillingProfileMetadata(nextMetadata, {
      cycleType: "monthly",
      recurringMonthlyFeeAmount: resolvedMonthlyFeeAmount,
    });
  }

  if (
    payload.isCustomMonthlyFee === true &&
    typeof payload.customMonthlyFeeAmount === "number" &&
    payload.customMonthlyFeeAmount > 0
  ) {
    nextMetadata = mergeMemberBillingProfileMetadata(nextMetadata, {
      recurringMonthlyFeeAmount: payload.customMonthlyFeeAmount,
    });
  }

  const statusChangedAt = new Date();
  const isDeactivating = payload.isActive === false && member.isActive !== false;
  const isReactivating = payload.isActive === true && member.isActive === false;

  if (isDeactivating) {
    const frozenBilling = reconcileMemberBillingState(member, branch, statusChangedAt);
    const frozenDueLedger = reconcileMemberBillingLedger(
      member,
      frozenBilling,
      statusChangedAt,
    );

    updatePayload.currentDueAmount = frozenBilling.currentDueAmount;

    if (frozenBilling.updatedNextPaymentDate) {
      updatePayload.nextPaymentDate = frozenBilling.updatedNextPaymentDate;
    }

    nextMetadata = mergeMemberBillingLedgerMetadata(
      mergeMemberBillingProfileMetadata(nextMetadata, {
        accrualStoppedAt: statusChangedAt.toISOString(),
      }),
      frozenDueLedger,
    );
  } else if (isReactivating) {
    const frozenInactiveBilling = reconcileMemberBillingState(
      member,
      branch,
      statusChangedAt,
    );
    const frozenDueLedger = reconcileMemberBillingLedger(
      member,
      frozenInactiveBilling,
      statusChangedAt,
    );

    updatePayload.currentDueAmount = frozenInactiveBilling.currentDueAmount;
    updatePayload.nextPaymentDate = resolveReactivatedNextPaymentDate(
      frozenInactiveBilling.updatedNextPaymentDate ?? member.nextPaymentDate,
      statusChangedAt,
    );

    nextMetadata = mergeMemberBillingLedgerMetadata(
      mergeMemberBillingProfileMetadata(nextMetadata, {
        accrualStoppedAt: undefined,
      }),
      frozenDueLedger,
    );
  }

  if (photoFile) {
    if (member.photo) {
      await unlinkFile(member.photo);
    }
    updatePayload.photo = storage.getObjectKey(photoFile.path);
  }

  if (
    nextMetadata !== member.metadata ||
    Object.prototype.hasOwnProperty.call(updatePayload, "metadata")
  ) {
    updatePayload.metadata = nextMetadata;
  }

  if (Object.keys(unsetPayload).length > 0) {
    updatePayload.$unset = unsetPayload;
  }

  const updatedMember = await MemberRepository.updateById(memberId, updatePayload);

  if (!updatedMember) {
    if (photoFile) {
      await unlinkFile(storage.getObjectKey(photoFile.path));
    }

    throw new AppError(StatusCodes.INTERNAL_SERVER_ERROR, "Failed to update member");
  }

  await Promise.all([
    cacheService.deleteCache(`members:${branchId}:${memberId}`),
    cacheService.invalidateByPattern(`members:${branchId}:list:*`),
  ]);

  return updatedMember;
};

const deleteMember = async (branchId: string, memberId: string, actor: TAccessActor) => {
  const branch = await resolveBranchAccess(branchId, actor);

  const member = await MemberRepository.findOne({
    _id: new Types.ObjectId(memberId),
    branchId: new Types.ObjectId(branchId),
  });

  if (!member) {
    throw new AppError(StatusCodes.NOT_FOUND, "Member not found");
  }

  const deletedAt = new Date();
  const frozenBilling = reconcileMemberBillingState(member, branch, deletedAt);
  const frozenDueLedger = reconcileMemberBillingLedger(
    member,
    frozenBilling,
    deletedAt,
  );

  const deletedMember = await MemberRepository.updateById(memberId, {
    ...buildMemberBillingUpdate(frozenBilling),
    isActive: false,
    metadata: mergeMemberBillingLedgerMetadata(
      mergeMemberBillingProfileMetadata(member.metadata, {
        accrualStoppedAt: deletedAt.toISOString(),
      }),
      frozenDueLedger,
    ),
  });

  if (!deletedMember) {
    throw new AppError(StatusCodes.INTERNAL_SERVER_ERROR, "Failed to delete member");
  }

  await Promise.all([
    cacheService.deleteCache(`members:${branchId}:${memberId}`),
    cacheService.invalidateByPattern(`members:${branchId}:list:*`),
  ]);

  return deletedMember;
};

const restoreMember = async (branchId: string, memberId: string, actor: TAccessActor) => {
  const branch = await resolveBranchAccess(branchId, actor);

  const member = await MemberRepository.findOne({
    _id: new Types.ObjectId(memberId),
    branchId: new Types.ObjectId(branchId),
  });

  if (!member) {
    throw new AppError(StatusCodes.NOT_FOUND, "Member not found");
  }

  const restoredAt = new Date();
  const frozenBilling = reconcileMemberBillingState(member, branch, restoredAt);
  const frozenDueLedger = reconcileMemberBillingLedger(
    member,
    frozenBilling,
    restoredAt,
  );

  const restoredMember = await MemberRepository.updateById(memberId, {
    currentDueAmount: frozenBilling.currentDueAmount,
    nextPaymentDate: resolveReactivatedNextPaymentDate(
      frozenBilling.updatedNextPaymentDate ?? member.nextPaymentDate,
      restoredAt,
    ),
    isActive: true,
    metadata: mergeMemberBillingLedgerMetadata(
      mergeMemberBillingProfileMetadata(member.metadata, {
        accrualStoppedAt: undefined,
      }),
      frozenDueLedger,
    ),
  });

  if (!restoredMember) {
    throw new AppError(StatusCodes.INTERNAL_SERVER_ERROR, "Failed to restore member");
  }

  await Promise.all([
    cacheService.deleteCache(`members:${branchId}:${memberId}`),
    cacheService.invalidateByPattern(`members:${branchId}:list:*`),
  ]);

  return restoredMember;
};

const getDashboardMemberSummary = async (
  branchId: string,
  actor: TAccessActor,
  query: TDashboardSummaryQuery,
) => {
  const branch = await resolveBranchAccess(branchId, actor);

  const branchObjectId = new Types.ObjectId(branchId);
  const parsedDays = Number(query.days);
  const days = Number.isFinite(parsedDays) && parsedDays > 0
    ? Math.min(Math.floor(parsedDays), 90)
    : 7;

  const now = new Date();
  const dueSoonDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const windowStart = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  await reconcileBranchMemberBilling(branchId, branch);

  const [
    totalMembers,
    activeMembers,
    inactiveMembers,
    importDraftMembers,
    newMembersInWindow,
    paymentDueNow,
    paymentDueSoon,
  ] = await Promise.all([
    MemberRepository.count({ branchId: branchObjectId }),
    MemberRepository.count({ branchId: branchObjectId, isActive: true }),
    MemberRepository.count({ branchId: branchObjectId, isActive: false }),
    MemberRepository.count({
      branchId: branchObjectId,
      isActive: false,
      source: "google_sheet",
    }),
    MemberRepository.count({
      branchId: branchObjectId,
      createdAt: { $gte: windowStart },
    }),
    MemberRepository.count({
      branchId: branchObjectId,
      isActive: true,
      currentDueAmount: { $gt: 0 },
    }),
    MemberRepository.count({
      branchId: branchObjectId,
      isActive: true,
      currentDueAmount: { $lte: 0 },
      nextPaymentDate: {
        $gt: now,
        $lte: dueSoonDate,
      },
    }),
  ]);

  return {
    windowDays: days,
    members: {
      totalMembers,
      activeMembers,
      inactiveMembers,
      importDraftMembers,
      newMembersInWindow,
    },
    billing: {
      paymentDueNow,
      paymentDueSoon,
    },
  };
};

export const MemberService = {
  createMember,
  getMembers,
  getMemberById,
  updateMember,
  deleteMember,
  restoreMember,
  getDashboardMemberSummary,
};
