import { getDhakaDateString } from "../../utils/dhakaTime";

export const DEFAULT_ACCESS_GRACE_DAYS = 5;
export const MAX_ACCESS_GRACE_DAYS = 31;
export const DEFAULT_ACCESS_DEBOUNCE_MINUTES = 5;

/**
 * Device user IDs at or above this value are staff/workers, never members.
 * (The client enrols staff as 100001, 100002, ...)
 */
export const STAFF_DEVICE_ID_MIN = 100000;

export type TAccessStatus =
  | "allowed"
  | "grace"
  | "blocked"
  | "log_only";

export type TAccessReason =
  | "access_control_disabled"
  | "override_allow"
  | "override_block"
  | "inactive"
  | "no_monthly_due"
  | "in_grace"
  | "monthly_due";

export type TAccessLedgerItem = {
  type?: string;
  remainingAmount?: number;
  dueDate?: string;
  periodStart?: string;
  key?: string;
};

export type TAccessOverride = {
  mode?: "allow" | "block" | null;
  until?: Date | string | null;
};

export type TComputeAccessInput = {
  isActive?: boolean;
  nextPaymentDate?: Date | string | null;
  ledgerItems?: TAccessLedgerItem[];
  accessOverride?: TAccessOverride | null;
  enabled: boolean;
  graceDays?: number;
  now?: Date;
};

export type TAccessDecision = {
  /** Should the device be told "enabled" for this member. */
  allowed: boolean;
  status: TAccessStatus;
  reason: TAccessReason;
  /** First Dhaka day (YYYY-MM-DD) of the oldest unpaid monthly period. */
  unpaidSince?: string;
  /** Last Dhaka day (YYYY-MM-DD) the member may still enter. */
  graceUntil?: string;
};

const MONTHLY_TYPES = new Set(["monthly_due", "monthly_cycle_due"]);

/**
 * Admin-given ids are zero padded inconsistently ("0075", "075", "75").
 * The device stores plain numbers, so both sides are compared without
 * leading zeros. Returns "" for empty input.
 */
export const normalizeMemberId = (value: unknown): string => {
  if (value === null || value === undefined) {
    return "";
  }

  const trimmed = String(value).replace(/\s+/g, "");
  if (!trimmed) {
    return "";
  }

  const stripped = trimmed.replace(/^0+/, "");
  return stripped === "" ? "0" : stripped.toLowerCase();
};

export const isStaffDeviceUserId = (deviceUserId: unknown): boolean => {
  const normalized = normalizeMemberId(deviceUserId);
  return /^\d+$/.test(normalized) && Number(normalized) >= STAFF_DEVICE_ID_MIN;
};

export const normalizeGraceDays = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_ACCESS_GRACE_DAYS;
  }

  return Math.min(MAX_ACCESS_GRACE_DAYS, Math.max(0, Math.floor(parsed)));
};

const addDaysToDateString = (dateString: string, days: number): string => {
  const [year = 0, month = 1, day = 1] = dateString.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return next.toISOString().slice(0, 10);
};

const toDhakaDay = (value: Date | string | null | undefined) => {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : getDhakaDateString(date);
};

const startOfDhakaMonth = (dateString: string) => `${dateString.slice(0, 7)}-01`;

/**
 * First Dhaka day of the oldest unpaid MONTHLY period, or null if none.
 * Admission and package dues are ignored on purpose.
 */
export const findOldestUnpaidMonthStart = (
  ledgerItems: TAccessLedgerItem[] | undefined,
  nextPaymentDate: Date | string | null | undefined,
  today: string,
): string | null => {
  const candidates: string[] = [];

  for (const item of ledgerItems ?? []) {
    if (!item.type || !MONTHLY_TYPES.has(item.type)) {
      continue;
    }

    if (!(Number(item.remainingAmount ?? 0) > 0)) {
      continue;
    }

    const day = toDhakaDay(item.periodStart ?? item.dueDate);
    if (day) {
      candidates.push(startOfDhakaMonth(day));
    }
  }

  if (candidates.length > 0) {
    return candidates.sort()[0] ?? null;
  }

  // The ledger is filled by a daily job. If it has not caught up yet, fall back
  // to the same rule the billing code uses: a month is overdue once
  // nextPaymentDate is before the current calendar month's end of day-one.
  const next = toDhakaDay(nextPaymentDate);
  if (next && next <= startOfDhakaMonth(today)) {
    return startOfDhakaMonth(next);
  }

  return null;
};

const isOverrideActive = (
  override: TAccessOverride | null | undefined,
  now: Date,
) => {
  if (!override?.mode) {
    return false;
  }

  if (!override.until) {
    return true;
  }

  const until = new Date(override.until);
  return Number.isNaN(until.getTime()) || until.getTime() > now.getTime();
};

export const computeAccess = (input: TComputeAccessInput): TAccessDecision => {
  const now = input.now ?? new Date();
  const today = getDhakaDateString(now);
  const graceDays = normalizeGraceDays(
    input.graceDays ?? DEFAULT_ACCESS_GRACE_DAYS,
  );

  if (isOverrideActive(input.accessOverride, now)) {
    const allow = input.accessOverride?.mode === "allow";
    return {
      allowed: allow,
      status: allow ? "allowed" : "blocked",
      reason: allow ? "override_allow" : "override_block",
    };
  }

  if (input.isActive === false) {
    return { allowed: false, status: "blocked", reason: "inactive" };
  }

  const unpaidSince = findOldestUnpaidMonthStart(
    input.ledgerItems,
    input.nextPaymentDate,
    today,
  );

  if (!unpaidSince) {
    return { allowed: true, status: "allowed", reason: "no_monthly_due" };
  }

  const graceUntil = addDaysToDateString(unpaidSince, graceDays);

  if (today <= graceUntil) {
    return {
      allowed: true,
      status: "grace",
      reason: "in_grace",
      unpaidSince,
      graceUntil,
    };
  }

  return {
    allowed: false,
    status: "blocked",
    reason: "monthly_due",
    unpaidSince,
    graceUntil,
  };
};

/**
 * Same decision, but when the branch has not enabled access control the door
 * is never touched: we still report what WOULD happen (`wouldBe`) so admins
 * can review it in log-only mode.
 */
export const computeAccessForBranch = (input: TComputeAccessInput) => {
  const decision = computeAccess(input);

  if (input.enabled) {
    return { ...decision, wouldBe: decision.status };
  }

  return {
    ...decision,
    allowed: true,
    status: "log_only" as TAccessStatus,
    reason: "access_control_disabled" as TAccessReason,
    wouldBe: decision.status,
  };
};
