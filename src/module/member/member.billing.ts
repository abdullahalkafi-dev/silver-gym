import { TBranch } from "../branch/branch.interface";
import {
  addMonthsPreservingDay,
  normalizeMoney,
  reconcileRecurringBillingBalance,
  startOfCalendarMonth,
} from "../payment/payment.balance";
import { TMember } from "./member.interface";

export const BILLING_PROFILE_METADATA_KEY = "billingProfile";

export type TMemberBillingCycleType = "monthly" | "package";

export type TMemberBillingProfile = {
  version: 1;
  cycleType?: TMemberBillingCycleType;
  accrualStoppedAt?: string;
  recurringMonthlyFeeAmount?: number;
};

type TBranchBillingConfig = Pick<TBranch, "monthlyFeeAmount">;

type TMemberBillingLike = Pick<
  TMember,
  | "currentDueAmount"
  | "nextPaymentDate"
  | "isActive"
  | "isCustomMonthlyFee"
  | "customMonthlyFeeAmount"
  | "metadata"
> & {
  _id?: unknown;
};

export type TReconciledMemberBilling = {
  currentDueAmount: number;
  updatedNextPaymentDate?: Date;
  monthlyFeeAmount?: number;
  openingDueAmount: number;
  openingNextPaymentDate?: Date;
  overdueMonths: number;
  accruedAmount: number;
  shouldPersist: boolean;
};

const toOptionalDate = (value?: Date | string | null): Date | undefined => {
  if (!value) {
    return undefined;
  }

  const nextDate = new Date(value);
  return Number.isNaN(nextDate.getTime()) ? undefined : nextDate;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const normalizeMemberBillingProfile = (
  value: unknown,
): TMemberBillingProfile => {
  const raw = isRecord(value) ? value : {};
  const cycleType =
    raw.cycleType === "monthly" || raw.cycleType === "package"
      ? raw.cycleType
      : undefined;
  const accrualStoppedAt =
    typeof raw.accrualStoppedAt === "string"
      ? toOptionalDate(raw.accrualStoppedAt)?.toISOString()
      : undefined;
  const recurringMonthlyFeeAmount =
    typeof raw.recurringMonthlyFeeAmount === "number" &&
    raw.recurringMonthlyFeeAmount > 0
      ? normalizeMoney(raw.recurringMonthlyFeeAmount)
      : undefined;

  return {
    version: 1,
    ...(cycleType ? { cycleType } : {}),
    ...(accrualStoppedAt ? { accrualStoppedAt } : {}),
    ...(recurringMonthlyFeeAmount
      ? { recurringMonthlyFeeAmount }
      : {}),
  };
};

export const readMemberBillingProfile = (
  metadata: unknown,
): TMemberBillingProfile => {
  if (!isRecord(metadata)) {
    return { version: 1 };
  }

  return normalizeMemberBillingProfile(metadata[BILLING_PROFILE_METADATA_KEY]);
};

export const mergeMemberBillingProfileMetadata = (
  metadata: unknown,
  profilePatch: Partial<Omit<TMemberBillingProfile, "version">>,
) => {
  const nextMetadata = isRecord(metadata) ? { ...metadata } : {};
  const currentProfile = readMemberBillingProfile(metadata);

  nextMetadata[BILLING_PROFILE_METADATA_KEY] = normalizeMemberBillingProfile({
    ...currentProfile,
    ...profilePatch,
  });

  return nextMetadata;
};

const areDatesEqual = (left?: Date, right?: Date): boolean => {
  if (!left && !right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return left.getTime() === right.getTime();
};

export const resolveMemberMonthlyFeeAmount = (
  member: Pick<TMember, "isCustomMonthlyFee" | "customMonthlyFeeAmount" | "metadata">,
  branch: TBranchBillingConfig,
): number | undefined => {
  const billingProfile = readMemberBillingProfile(member.metadata);

  if (
    member.isCustomMonthlyFee &&
    typeof member.customMonthlyFeeAmount === "number" &&
    member.customMonthlyFeeAmount > 0
  ) {
    return member.customMonthlyFeeAmount;
  }

  if (
    typeof billingProfile.recurringMonthlyFeeAmount === "number" &&
    billingProfile.recurringMonthlyFeeAmount > 0
  ) {
    return billingProfile.recurringMonthlyFeeAmount;
  }

  if (typeof branch.monthlyFeeAmount === "number" && branch.monthlyFeeAmount > 0) {
    return branch.monthlyFeeAmount;
  }

  return undefined;
};

export const buildMemberBillingUpdate = (
  billing: Pick<
    TReconciledMemberBilling,
    "currentDueAmount" | "updatedNextPaymentDate"
  >,
  options?: { persistNextPaymentDate?: boolean },
) => ({
  currentDueAmount: billing.currentDueAmount,
  ...(options?.persistNextPaymentDate !== false && billing.updatedNextPaymentDate
    ? { nextPaymentDate: billing.updatedNextPaymentDate }
    : {}),
});

export const applyBillingToMember = <T extends TMemberBillingLike>(
  member: T,
  billing: Pick<
    TReconciledMemberBilling,
    "currentDueAmount" | "updatedNextPaymentDate"
  >,
): T & {
  currentDueAmount: number;
  nextPaymentDate?: Date;
} => ({
  ...member,
  currentDueAmount: billing.currentDueAmount,
  ...(billing.updatedNextPaymentDate
    ? { nextPaymentDate: billing.updatedNextPaymentDate }
    : {}),
});

export const reconcileMemberBillingState = (
  member: TMemberBillingLike,
  branch: TBranchBillingConfig,
  now: Date = new Date(),
): TReconciledMemberBilling => {
  const monthlyFeeAmount = resolveMemberMonthlyFeeAmount(member, branch);
  const openingNextPaymentDate = toOptionalDate(member.nextPaymentDate);
  const openingDueAmount = normalizeMoney(member.currentDueAmount ?? 0);
  const billingProfile = readMemberBillingProfile(member.metadata);
  const accrualEndDate =
    member.isActive === false
      ? toOptionalDate(billingProfile.accrualStoppedAt)
      : undefined;
  const snapshot = reconcileRecurringBillingBalance({
    nextPaymentDate: openingNextPaymentDate,
    recurringChargeAmount: monthlyFeeAmount,
    openingNetBalance: openingDueAmount,
    isActive: member.isActive !== false,
    accrualEndDate,
    now,
  });

  const shouldPersist =
    snapshot.currentDueAmount !== openingDueAmount ||
    !areDatesEqual(openingNextPaymentDate, snapshot.updatedNextPaymentDate);

  return {
    currentDueAmount: snapshot.currentDueAmount,
    updatedNextPaymentDate: snapshot.updatedNextPaymentDate,
    monthlyFeeAmount,
    openingDueAmount,
    openingNextPaymentDate,
    overdueMonths: snapshot.overdueMonths,
    accruedAmount: snapshot.accruedAmount,
    shouldPersist,
  };
};

export const calculateMonthlyCycleEndDate = (
  startDate: Date,
  paidMonths: number,
): Date => addMonthsPreservingDay(startDate, paidMonths);

export const resolveReactivatedNextPaymentDate = (
  nextPaymentDate: Date | string | undefined,
  now: Date = new Date(),
) => {
  const currentMonthStart = startOfCalendarMonth(now);

  if (!nextPaymentDate) {
    return currentMonthStart;
  }

  const normalizedNextPaymentDate = new Date(nextPaymentDate);

  if (Number.isNaN(normalizedNextPaymentDate.getTime())) {
    return currentMonthStart;
  }

  return normalizedNextPaymentDate > currentMonthStart
    ? normalizedNextPaymentDate
    : currentMonthStart;
};