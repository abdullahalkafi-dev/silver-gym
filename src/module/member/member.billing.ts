import { TBranch } from "../branch/branch.interface";
import {
  addMonthsPreservingDay,
  getMemberNetBalance,
  normalizeMoney,
  reconcileRecurringBillingBalance,
} from "../payment/payment.balance";
import { TMember } from "./member.interface";

type TBranchBillingConfig = Pick<TBranch, "monthlyFeeAmount">;

type TMemberBillingLike = Pick<
  TMember,
  | "currentDueAmount"
  | "currentAdvanceAmount"
  | "nextPaymentDate"
  | "isActive"
  | "isCustomMonthlyFee"
  | "customMonthlyFeeAmount"
> & {
  _id?: unknown;
};

export type TReconciledMemberBilling = {
  currentDueAmount: number;
  currentAdvanceAmount: number;
  updatedNextPaymentDate?: Date;
  monthlyFeeAmount?: number;
  openingDueAmount: number;
  openingAdvanceAmount: number;
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
  member: Pick<TMember, "isCustomMonthlyFee" | "customMonthlyFeeAmount">,
  branch: TBranchBillingConfig,
): number | undefined => {
  if (
    member.isCustomMonthlyFee &&
    typeof member.customMonthlyFeeAmount === "number" &&
    member.customMonthlyFeeAmount > 0
  ) {
    return member.customMonthlyFeeAmount;
  }

  if (typeof branch.monthlyFeeAmount === "number" && branch.monthlyFeeAmount > 0) {
    return branch.monthlyFeeAmount;
  }

  return undefined;
};

export const buildMemberBillingUpdate = (
  billing: Pick<
    TReconciledMemberBilling,
    "currentDueAmount" | "currentAdvanceAmount" | "updatedNextPaymentDate"
  >,
) => ({
  currentDueAmount: billing.currentDueAmount,
  currentAdvanceAmount: billing.currentAdvanceAmount,
  ...(billing.updatedNextPaymentDate
    ? { nextPaymentDate: billing.updatedNextPaymentDate }
    : {}),
});

export const applyBillingToMember = <T extends TMemberBillingLike>(
  member: T,
  billing: Pick<
    TReconciledMemberBilling,
    "currentDueAmount" | "currentAdvanceAmount" | "updatedNextPaymentDate"
  >,
): T & {
  currentDueAmount: number;
  currentAdvanceAmount: number;
  nextPaymentDate?: Date;
} => ({
  ...member,
  currentDueAmount: billing.currentDueAmount,
  currentAdvanceAmount: billing.currentAdvanceAmount,
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
  const openingAdvanceAmount = normalizeMoney(member.currentAdvanceAmount ?? 0);
  const snapshot = reconcileRecurringBillingBalance({
    nextPaymentDate: openingNextPaymentDate,
    recurringChargeAmount: monthlyFeeAmount,
    openingNetBalance: getMemberNetBalance(member),
    isActive: member.isActive !== false,
    now,
  });

  const shouldPersist =
    snapshot.currentDueAmount !== openingDueAmount ||
    snapshot.currentAdvanceAmount !== openingAdvanceAmount ||
    !areDatesEqual(openingNextPaymentDate, snapshot.updatedNextPaymentDate);

  return {
    currentDueAmount: snapshot.currentDueAmount,
    currentAdvanceAmount: snapshot.currentAdvanceAmount,
    updatedNextPaymentDate: snapshot.updatedNextPaymentDate,
    monthlyFeeAmount,
    openingDueAmount,
    openingAdvanceAmount,
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