import { PackageDurationType } from "../package/package.interface";
import {
  isSameCalendarDay,
  normalizeMoney,
  startOfCalendarDay,
  startOfCalendarMonth,
  startOfNextCalendarMonth,
} from "./payment.balance";

export type TShortTermMonthlyTransition = {
  shouldDeactivateMember: boolean;
  canTransitionToMonthly: boolean;
  expiryDate?: Date;
  monthlyAnchorDate?: Date;
  suggestedDiscountAmount?: number;
  coveredDaysInAnchorMonth?: number;
  daysInAnchorMonth?: number;
};

type TShortTermMonthlyTransitionInput = {
  currentPackageDurationType?: string;
  membershipStartDate?: Date | string;
  membershipEndDate?: Date | string;
  nextPaymentDate?: Date | string;
  monthlyFeeAmount?: number;
  isActive?: boolean;
  now?: Date;
};

const toOptionalDate = (value?: Date | string | null): Date | undefined => {
  if (!value) {
    return undefined;
  }

  const nextDate = new Date(value);
  return Number.isNaN(nextDate.getTime()) ? undefined : nextDate;
};

const getLaterDate = (left: Date, right: Date): Date =>
  left > right ? left : right;

const getEarlierDate = (left: Date, right: Date): Date =>
  left < right ? left : right;

const getDayDifference = (startDate: Date, endDateExclusive: Date): number => {
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  return Math.max(
    0,
    Math.round(
      (startOfCalendarDay(endDateExclusive).getTime() -
        startOfCalendarDay(startDate).getTime()) /
        millisecondsPerDay,
    ),
  );
};

export const isShortTermPackageDuration = (durationType?: string) =>
  durationType === PackageDurationType.DAY ||
  durationType === PackageDurationType.WEEK;

export const resolveShortTermMonthlyTransition = ({
  currentPackageDurationType,
  membershipStartDate,
  membershipEndDate,
  nextPaymentDate,
  monthlyFeeAmount,
  isActive = true,
  now = new Date(),
}: TShortTermMonthlyTransitionInput): TShortTermMonthlyTransition => {
  if (!isShortTermPackageDuration(currentPackageDurationType)) {
    return {
      shouldDeactivateMember: false,
      canTransitionToMonthly: false,
    };
  }

  const expiryDate = toOptionalDate(membershipEndDate) ?? toOptionalDate(nextPaymentDate);

  if (!expiryDate) {
    return {
      shouldDeactivateMember: false,
      canTransitionToMonthly: false,
    };
  }

  const normalizedNow = startOfCalendarDay(now);
  const normalizedExpiryDate = startOfCalendarDay(expiryDate);
  const monthlyAnchorDate = startOfCalendarMonth(expiryDate);
  const shouldDeactivateMember =
    isActive !== false && normalizedNow >= normalizedExpiryDate;
  const canTransitionToMonthly = isSameCalendarDay(normalizedNow, normalizedExpiryDate);

  const packageStartDate = toOptionalDate(membershipStartDate);
  const anchorMonthEnd = startOfNextCalendarMonth(monthlyAnchorDate);
  const daysInAnchorMonth = getDayDifference(monthlyAnchorDate, anchorMonthEnd);

  if (
    !packageStartDate ||
    monthlyFeeAmount == null ||
    monthlyFeeAmount <= 0 ||
    !canTransitionToMonthly
  ) {
    return {
      shouldDeactivateMember,
      canTransitionToMonthly,
      expiryDate,
      monthlyAnchorDate,
      ...(daysInAnchorMonth > 0 ? { daysInAnchorMonth } : {}),
    };
  }

  const coveredRangeStart = getLaterDate(
    startOfCalendarDay(packageStartDate),
    monthlyAnchorDate,
  );
  const coveredRangeEnd = getEarlierDate(normalizedExpiryDate, anchorMonthEnd);
  const coveredDaysInAnchorMonth = getDayDifference(
    coveredRangeStart,
    coveredRangeEnd,
  );
  const suggestedDiscountAmount =
    coveredDaysInAnchorMonth > 0 && daysInAnchorMonth > 0
      ? normalizeMoney((monthlyFeeAmount * coveredDaysInAnchorMonth) / daysInAnchorMonth)
      : 0;

  return {
    shouldDeactivateMember,
    canTransitionToMonthly,
    expiryDate,
    monthlyAnchorDate,
    ...(coveredDaysInAnchorMonth > 0 ? { coveredDaysInAnchorMonth } : {}),
    ...(daysInAnchorMonth > 0 ? { daysInAnchorMonth } : {}),
    ...(suggestedDiscountAmount > 0
      ? { suggestedDiscountAmount }
      : {}),
  };
};