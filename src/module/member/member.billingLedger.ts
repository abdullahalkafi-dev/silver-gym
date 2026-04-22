import { addMonthsPreservingDay, normalizeMoney } from "../payment/payment.balance";
import { TReconciledMemberBilling } from "./member.billing";

export const BILLING_LEDGER_METADATA_KEY = "billingDueLedger";

export type TMemberBillingLedgerItemType =
  | "admission_due"
  | "monthly_due"
  | "carry_forward"
  | "monthly_cycle_due"
  | "package_due";

export type TMemberBillingLedgerItem = {
  key: string;
  type: TMemberBillingLedgerItemType;
  label: string;
  originalAmount: number;
  remainingAmount: number;
  dueDate?: string;
  periodStart?: string;
  periodEnd?: string;
  packageId?: string;
  createdAt: string;
};

export type TMemberBillingLedger = {
  version: 1;
  items: TMemberBillingLedgerItem[];
  updatedAt: string;
};

type TMemberMetadataLike = {
  metadata?: unknown;
};

type TCreateLedgerItemInput = {
  key?: string;
  type: TMemberBillingLedgerItemType;
  label: string;
  amount: number;
  now?: Date;
  dueDate?: Date | string;
  periodStart?: Date | string;
  periodEnd?: Date | string;
  packageId?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const PRIORITY_TYPES: TMemberBillingLedgerItemType[] = ["admission_due", "carry_forward"];

const sortLedgerItems = (items: TMemberBillingLedgerItem[]) => {
  return [...items].sort((left, right) => {
    const leftPriority = PRIORITY_TYPES.indexOf(left.type);
    const rightPriority = PRIORITY_TYPES.indexOf(right.type);

    const leftIsPriority = leftPriority !== -1;
    const rightIsPriority = rightPriority !== -1;

    if (leftIsPriority && !rightIsPriority) return -1;
    if (!leftIsPriority && rightIsPriority) return 1;
    if (leftIsPriority && rightIsPriority) return leftPriority - rightPriority;

    const leftDate = left.dueDate || left.createdAt;
    const rightDate = right.dueDate || right.createdAt;

    return leftDate.localeCompare(rightDate);
  });
};

const normalizeLedgerItems = (items: TMemberBillingLedgerItem[]) => {
  return sortLedgerItems(
    items
      .map((item) => ({
        ...item,
        originalAmount: normalizeMoney(item.originalAmount),
        remainingAmount: normalizeMoney(item.remainingAmount),
      }))
      .filter((item) => item.remainingAmount > 0),
  );
};

const formatMonthLabel = (date: Date) => {
  return date.toLocaleDateString("en-GB", {
    month: "short",
    year: "numeric",
  });
};

const createLedger = (
  items: TMemberBillingLedgerItem[],
  now: Date,
): TMemberBillingLedger => ({
  version: 1,
  items: normalizeLedgerItems(items),
  updatedAt: now.toISOString(),
});

const createCarryForwardLedgerItem = (
  amount: number,
  now: Date,
  label = "Previous balance",
): TMemberBillingLedgerItem => ({
  key: `carry_forward:${now.getTime()}`,
  type: "carry_forward",
  label,
  originalAmount: normalizeMoney(amount),
  remainingAmount: normalizeMoney(amount),
  createdAt: now.toISOString(),
});

const toIsoString = (value?: Date | string) => {
  if (!value) {
    return undefined;
  }

  const nextDate = new Date(value);
  return Number.isNaN(nextDate.getTime()) ? undefined : nextDate.toISOString();
};

const createMonthlyDueLedgerItem = (
  dueDate: Date,
  amount: number,
): TMemberBillingLedgerItem => ({
  key: `monthly_due:${dueDate.getFullYear()}-${String(dueDate.getMonth() + 1).padStart(2, "0")}`,
  type: "monthly_due",
  label: formatMonthLabel(dueDate),
  originalAmount: normalizeMoney(amount),
  remainingAmount: normalizeMoney(amount),
  dueDate: dueDate.toISOString(),
  createdAt: dueDate.toISOString(),
});

const reduceLedgerItems = (
  items: TMemberBillingLedgerItem[],
  amount: number,
) => {
  let remainingToReduce = normalizeMoney(amount);
  const nextItems = sortLedgerItems(items).map((item) => ({ ...item }));

  for (const item of nextItems) {
    if (remainingToReduce <= 0) {
      break;
    }

    const reduction = Math.min(item.remainingAmount, remainingToReduce);
    item.remainingAmount = normalizeMoney(item.remainingAmount - reduction);
    remainingToReduce = normalizeMoney(remainingToReduce - reduction);
  }

  return normalizeLedgerItems(nextItems);
};

export const sumMemberBillingLedger = (items: TMemberBillingLedgerItem[]) => {
  return normalizeMoney(
    items.reduce((total, item) => total + normalizeMoney(item.remainingAmount), 0),
  );
};

export const createAdmissionDueLedgerItem = (
  amount: number,
  now: Date = new Date(),
): TMemberBillingLedgerItem => ({
  key: `admission_due:${now.getTime()}`,
  type: "admission_due",
  label: "Admission Due",
  originalAmount: normalizeMoney(amount),
  remainingAmount: normalizeMoney(amount),
  createdAt: now.toISOString(),
});

export const createMemberBillingLedgerItem = ({
  key,
  type,
  label,
  amount,
  now = new Date(),
  dueDate,
  periodStart,
  periodEnd,
  packageId,
}: TCreateLedgerItemInput): TMemberBillingLedgerItem => ({
  key: key || `${type}:${now.getTime()}`,
  type,
  label,
  originalAmount: normalizeMoney(amount),
  remainingAmount: normalizeMoney(amount),
  dueDate: toIsoString(dueDate),
  periodStart: toIsoString(periodStart),
  periodEnd: toIsoString(periodEnd),
  packageId,
  createdAt: now.toISOString(),
});

export const alignMemberBillingLedgerToDueAmount = (
  items: TMemberBillingLedgerItem[],
  targetDueAmount: number,
  now: Date = new Date(),
): TMemberBillingLedger => {
  let nextItems = normalizeLedgerItems(items);
  const ledgerTotal = sumMemberBillingLedger(nextItems);
  const difference = normalizeMoney(normalizeMoney(targetDueAmount) - ledgerTotal);

  if (difference > 0) {
    nextItems = normalizeLedgerItems([
      ...nextItems,
      createCarryForwardLedgerItem(difference, now),
    ]);
  } else if (difference < 0) {
    nextItems = reduceLedgerItems(nextItems, Math.abs(difference));
  }

  return createLedger(nextItems, now);
};

export const readMemberBillingLedger = (
  member: TMemberMetadataLike,
): TMemberBillingLedger => {
  if (!isRecord(member.metadata)) {
    return createLedger([], new Date(0));
  }

  const rawLedger = member.metadata[BILLING_LEDGER_METADATA_KEY];

  if (!isRecord(rawLedger) || !Array.isArray(rawLedger.items)) {
    return createLedger([], new Date(0));
  }

  const rawItems = rawLedger.items.filter(isRecord);

  return {
    version: rawLedger.version === 1 ? 1 : 1,
    items: normalizeLedgerItems(
      rawItems.map((item) => ({
        key: String(item.key || ""),
        type: (item.type as TMemberBillingLedgerItemType) || "carry_forward",
        label: String(item.label || "Previous balance"),
        originalAmount: Number(item.originalAmount || 0),
        remainingAmount: Number(item.remainingAmount || 0),
        dueDate:
          typeof item.dueDate === "string" ? item.dueDate : undefined,
        periodStart:
          typeof item.periodStart === "string" ? item.periodStart : undefined,
        periodEnd:
          typeof item.periodEnd === "string" ? item.periodEnd : undefined,
        packageId:
          typeof item.packageId === "string" ? item.packageId : undefined,
        createdAt:
          typeof item.createdAt === "string"
            ? item.createdAt
            : new Date(0).toISOString(),
      })),
    ),
    updatedAt:
      typeof rawLedger.updatedAt === "string"
        ? rawLedger.updatedAt
        : new Date(0).toISOString(),
  };
};

export const mergeMemberBillingLedgerMetadata = (
  metadata: unknown,
  ledger: TMemberBillingLedger,
) => {
  const nextMetadata = isRecord(metadata) ? { ...metadata } : {};
  nextMetadata[BILLING_LEDGER_METADATA_KEY] = ledger;
  return nextMetadata;
};

export const hasMemberBillingLedgerChanged = (
  metadata: unknown,
  nextLedger: TMemberBillingLedger,
) => {
  const currentLedger = readMemberBillingLedger({ metadata });

  return JSON.stringify({
    version: currentLedger.version,
    items: currentLedger.items,
  }) !==
    JSON.stringify({
      version: nextLedger.version,
      items: nextLedger.items,
    });
};

export const reconcileMemberBillingLedger = (
  member: TMemberMetadataLike,
  billing: TReconciledMemberBilling,
  now: Date = new Date(),
): TMemberBillingLedger => {
  let nextItems = readMemberBillingLedger(member).items;

  if (nextItems.length === 0 && billing.openingDueAmount > 0) {
    // Legacy fallback: if member has no ledger yet but has a due amount,
    // represent it as a carry_forward so the reconciliation math still works.
    nextItems = [createCarryForwardLedgerItem(billing.openingDueAmount, now)];
  }

  if (
    billing.overdueMonths > 0 &&
    billing.openingNextPaymentDate &&
    billing.monthlyFeeAmount != null &&
    billing.monthlyFeeAmount > 0
  ) {
    let dueDate = new Date(billing.openingNextPaymentDate);
    const monthlyItems: TMemberBillingLedgerItem[] = [...nextItems];

    for (let index = 0; index < billing.overdueMonths; index += 1) {
      const ledgerItem = createMonthlyDueLedgerItem(dueDate, billing.monthlyFeeAmount);
      if (!monthlyItems.some((item) => item.key === ledgerItem.key)) {
        monthlyItems.push(ledgerItem);
      }
      dueDate = addMonthsPreservingDay(dueDate, 1);
    }

    nextItems = monthlyItems;
  }

  return alignMemberBillingLedgerToDueAmount(
    nextItems,
    billing.currentDueAmount,
    now,
  );
};