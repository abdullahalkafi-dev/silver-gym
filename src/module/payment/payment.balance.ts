type TPaymentSettlementInput = {
  subTotal?: number;
  paidTotal?: number;
  discount?: number;
};

type TRecurringBillingInput = {
  nextPaymentDate?: Date | null;
  recurringChargeAmount?: number | null;
  openingNetBalance?: number | null;
  isActive?: boolean | null;
  now?: Date;
};

type TMemberBalanceLike = {
  currentDueAmount?: number | null;
  currentAdvanceAmount?: number | null;
};

export type TPaymentSettlement = {
  netAmount: number;
  dueAmount: number;
  advanceAmount: number;
};

export type TMemberBalanceSnapshot = {
  currentDueAmount: number;
  currentAdvanceAmount: number;
};

export type TRecurringBillingBalance = TMemberBalanceSnapshot & {
  overdueMonths: number;
  accruedAmount: number;
  updatedNextPaymentDate?: Date;
};

export const normalizeMoney = (value: number): number => {
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  return Math.abs(rounded) < 0.005 ? 0 : rounded;
};

export const computePaymentSettlement = ({
  subTotal = 0,
  paidTotal = 0,
  discount = 0,
}: TPaymentSettlementInput): TPaymentSettlement => {
  const netAmount = normalizeMoney(subTotal - discount - paidTotal);

  return {
    netAmount,
    dueAmount: netAmount > 0 ? netAmount : 0,
    advanceAmount: netAmount < 0 ? Math.abs(netAmount) : 0,
  };
};

export const addMonthsPreservingDay = (date: Date, months: number): Date => {
  const nextDate = new Date(date);
  const dayOfMonth = nextDate.getDate();
  const hours = nextDate.getHours();
  const minutes = nextDate.getMinutes();
  const seconds = nextDate.getSeconds();
  const milliseconds = nextDate.getMilliseconds();

  nextDate.setDate(1);
  nextDate.setMonth(nextDate.getMonth() + months);

  const daysInTargetMonth = new Date(
    nextDate.getFullYear(),
    nextDate.getMonth() + 1,
    0,
  ).getDate();

  nextDate.setDate(Math.min(dayOfMonth, daysInTargetMonth));
  nextDate.setHours(hours, minutes, seconds, milliseconds);

  return nextDate;
};

export const reconcileRecurringBillingBalance = ({
  nextPaymentDate,
  recurringChargeAmount,
  openingNetBalance = 0,
  isActive = true,
  now = new Date(),
}: TRecurringBillingInput): TRecurringBillingBalance => {
  const normalizedOpeningNet = normalizeMoney(openingNetBalance ?? 0);
  const openingSnapshot = toMemberBalanceSnapshot(normalizedOpeningNet);

  if (
    !nextPaymentDate ||
    !isActive ||
    recurringChargeAmount == null ||
    recurringChargeAmount <= 0
  ) {
    return {
      ...openingSnapshot,
      overdueMonths: 0,
      accruedAmount: 0,
      updatedNextPaymentDate: nextPaymentDate ?? undefined,
    };
  }

  let updatedNextPaymentDate = new Date(nextPaymentDate);
  let overdueMonths = 0;
  let loopGuard = 0;

  while (updatedNextPaymentDate <= now && loopGuard < 600) {
    overdueMonths += 1;
    updatedNextPaymentDate = addMonthsPreservingDay(updatedNextPaymentDate, 1);
    loopGuard += 1;
  }

  const accruedAmount = normalizeMoney(overdueMonths * recurringChargeAmount);
  const closingSnapshot = toMemberBalanceSnapshot(
    normalizedOpeningNet + accruedAmount,
  );

  return {
    ...closingSnapshot,
    overdueMonths,
    accruedAmount,
    updatedNextPaymentDate,
  };
};

export const getMemberNetBalance = (member: TMemberBalanceLike): number => {
  return normalizeMoney(
    (member.currentDueAmount ?? 0) - (member.currentAdvanceAmount ?? 0),
  );
};

export const toMemberBalanceSnapshot = (netAmount: number): TMemberBalanceSnapshot => {
  const normalizedNet = normalizeMoney(netAmount);

  return {
    currentDueAmount: normalizedNet > 0 ? normalizedNet : 0,
    currentAdvanceAmount: normalizedNet < 0 ? Math.abs(normalizedNet) : 0,
  };
};

export const applyNetBalanceDelta = (
  member: TMemberBalanceLike,
  netDelta: number,
): TMemberBalanceSnapshot => {
  return toMemberBalanceSnapshot(getMemberNetBalance(member) + normalizeMoney(netDelta));
};