import { randomUUID } from "crypto";
import { StatusCodes } from "http-status-codes";
import { Types } from "mongoose";
import config from "../../config";
import AppError from "../../errors/AppError";
import cacheService from "../../redis-client/cacheService";
import { normalizeBangladeshPhone } from "../../utils/bangladeshPhone";
import {
  getDhakaDateString,
  getDhakaDayOfMonth,
  getDhakaHour,
  getDhakaMonth,
  getDhakaYear,
  formatEnglishMonth,
  formatEnglishAmount,
} from "../../utils/dhakaTime";
import {
  normalizeBranchSMSSettings,
  TBranch,
  TBranchSMSAutoToggles,
  TBranchSMSSettings,
} from "../branch/branch.interface";
import { Branch } from "../branch/branch.model";
import { BranchRepository } from "../branch/branch.repository";
import { BusinessProfileRepository } from "../businessProfile/businessProfile.repository";
import { SchedulerLockService } from "../scheduler/schedulerLock.service";
import { normalizeMoney } from "../payment/payment.balance";
import { TStaff } from "../staff/staff.interface";
import { reconcileMemberBillingState } from "../member/member.billing";
import { MemberRepository } from "../member/member.repository";
import { TMember } from "../member/member.interface";
import {
  TSmsAudience,
  TSmsBalanceSnapshot,
  TSmsDueDuration,
  TSmsDueDurationCounts,
  TSmsHistory,
  TSmsHistoryStatus,
  TSmsSendMode,
} from "./sms.interface";
import { maskPhone, smsLog } from "./sms.log";
import { SmsHistory, SmsHoliday } from "./sms.model";
import { SmsProvider } from "./sms.provider";
import { SmsRepository } from "./sms.repository";
import {
  CUSTOM_MESSAGE_MAX_CHARS,
  detectUnicode,
  estimateSmsUnits,
  formatHolidayDates,
  HOLIDAY_OTHER_REASON_MAX_CHARS,
  HOLIDAY_REASONS,
  isPlainSmsText,
  renderSmsText,
  sanitizeSmsText,
  singleSmsLimit,
  SMS_MAX_CREDITS_CUSTOM,
  SMS_MAX_CREDITS_TEMPLATE,
  SMS_TEMPLATE_LIST,
  SMS_TEMPLATES,
  TSmsMessageKind,
  TSmsTemplateKey,
} from "./sms.templates";

export type TSmsActor = {
  userId?: Types.ObjectId;
  staff?: TStaff & { _id?: Types.ObjectId };
  system?: boolean;
  /** Owner, or a staff member whose role is an admin role. */
  isAdmin?: boolean;
};

export type TSmsSendPayload = {
  kind: "dueReminder" | "holiday" | "custom";
  audience?: TSmsAudience;
  memberIds?: string[];
  dueDuration?: TSmsDueDuration;
  targetDate?: Date;
  message?: string;
  holidayId?: string;
};

type TMemberLite = Pick<TMember, "fullName" | "memberId" | "contact" | "isActive"> & {
  _id?: unknown;
};

type TCandidate = {
  member: TMemberLite;
  values: Record<string, string>;
  /** Already-rendered text (used when retrying a failed message). */
  text?: string;
  dedupeKey?: string;
  due?: { label: string; months: number; total: number };
};

type TRow = {
  candidate: TCandidate;
  phone: string | null;
  text: string;
  unicode: boolean;
  units: number;
  status: "ready" | "skipped";
  reason?: string;
  /** Skipped only because it would cost more credits than allowed (always recorded in History). */
  creditLimitSkip?: boolean;
};

const actorLabel = (actor?: TSmsActor) => {
  if (!actor) return "unknown";
  if (actor.system) return "system";
  if (actor.userId) return `owner:${String(actor.userId)}`;
  if (actor.staff?._id) return `staff:${String(actor.staff._id)}`;
  return "unknown";
};

const MEMBER_SELECT =
  "fullName memberId contact isActive dateOfBirth currentDueAmount nextPaymentDate isCustomMonthlyFee customMonthlyFeeAmount metadata";
const BALANCE_CACHE_KEY = "sms:fastsmsbd:balance";
const SCHEDULER_INTERVAL_MS = 15 * 60 * 1000;
const SMS_LOCK_DURATION_MS = 10 * 60 * 1000;
const SMS_LOCK_NAME = "sms-automation";
const LARGE_SEND_THRESHOLD = 50;

let schedulerHandle: NodeJS.Timeout | null = null;

// ───────────────────────────── helpers ─────────────────────────────

const formatDueMonthLabel = (targetDate: Date, overdueMonths: number) => {
  const safe = Math.max(overdueMonths, 1);
  const endMonth = new Date(targetDate.getFullYear(), targetDate.getMonth(), 1);
  const startMonth = new Date(endMonth.getFullYear(), endMonth.getMonth() - safe + 1, 1);

  if (startMonth.getTime() === endMonth.getTime()) return formatEnglishMonth(endMonth);
  if (startMonth.getFullYear() === endMonth.getFullYear()) {
    return `${formatEnglishMonth(startMonth)}-${formatEnglishMonth(endMonth)}`;
  }
  return `${formatEnglishMonth(startMonth, true)}-${formatEnglishMonth(endMonth, true)}`;
};

const matchesDueDuration = (months: number, duration: TSmsDueDuration) => {
  if (months <= 0) return false;
  switch (duration) {
    case "thisMonth":
      return months === 1;
    case "last2Months":
      return months <= 2;
    case "last3Months":
      return months <= 3;
    case "allDue":
    default:
      return true;
  }
};

const buildDueDurationCounts = (candidates: TCandidate[]): TSmsDueDurationCounts => {
  const count = (d: TSmsDueDuration) =>
    candidates.filter((c) => matchesDueDuration(c.due?.months ?? 0, d)).length;
  return {
    thisMonth: count("thisMonth"),
    last2Months: count("last2Months"),
    last3Months: count("last3Months"),
    allDue: count("allDue"),
  };
};

const resolveBranchAccess = async (
  businessId: string,
  branchId: string,
  actor?: TSmsActor,
) => {
  const branch = await BranchRepository.findOne({
    _id: new Types.ObjectId(branchId),
    businessId: new Types.ObjectId(businessId),
    isActive: true,
  });

  if (!branch) {
    throw new AppError(StatusCodes.NOT_FOUND, "Branch not found");
  }
  if (actor?.system) return branch;

  if (actor?.userId) {
    const business = await BusinessProfileRepository.findOne({
      _id: new Types.ObjectId(businessId),
      userId: actor.userId,
    });
    if (!business) {
      throw new AppError(StatusCodes.FORBIDDEN, "You do not have permission to access this branch");
    }
    return branch;
  }

  if (actor?.staff) {
    if (!actor.staff.isActive) {
      throw new AppError(StatusCodes.FORBIDDEN, "Staff account is inactive");
    }
    if (String(actor.staff.branchId) !== String(branch._id)) {
      throw new AppError(StatusCodes.FORBIDDEN, "You do not have permission to access this branch");
    }
    return branch;
  }

  throw new AppError(StatusCodes.UNAUTHORIZED, "You are not authorized");
};

const requireAdmin = (actor: TSmsActor) => {
  if (actor.system || actor.isAdmin || actor.userId) return;
  throw new AppError(StatusCodes.FORBIDDEN, "Only the owner or an admin can do this");
};

const getBalance = async (businessId: string, branchId: string, actor: TSmsActor) => {
  await resolveBranchAccess(businessId, branchId, actor);
  return SmsProvider.getBalance();
};

// ───────────────────────────── settings ─────────────────────────────

const describeTemplates = (settings: TBranchSMSSettings) =>
  SMS_TEMPLATE_LIST.map((template) => {
    const rendered = renderSmsText(template.text, template.sample).text;
    return {
      key: template.key,
      label: template.label,
      text: template.text,
      example: rendered,
      units: estimateSmsUnits(rendered),
      maxCredits: SMS_MAX_CREDITS_TEMPLATE,
      placeholders: template.placeholders,
      whenSent: template.whenSent,
      whoReceives: template.whoReceives,
      automatic: template.automatic,
      enabled: template.automatic
        ? settings.toggles[template.key as keyof TBranchSMSAutoToggles] === true
        : null,
    };
  });

const buildSettingsSnapshot = (branch: TBranch & { _id?: Types.ObjectId }) => {
  const plain = typeof (branch as any).toObject === "function" ? (branch as any).toObject() : branch;
  const settings = normalizeBranchSMSSettings(plain.smsSettings);
  return {
    branchId: plain._id,
    branchName: plain.branchName,
    smsSettings: settings,
    templates: describeTemplates(settings),
    dryRun: config.sms.dry_run !== false,
  };
};

const getSettings = async (businessId: string, branchId: string, actor: TSmsActor) => {
  const branch = await resolveBranchAccess(businessId, branchId, actor);
  return buildSettingsSnapshot(branch);
};

type TSettingsUpdate = {
  enabled?: boolean;
  maskingSender?: string | null;
  reminderDayOfMonth?: number;
  reminderHour?: number;
  birthdayHour?: number;
  toggles?: Partial<TBranchSMSAutoToggles>;
};

const updateSettings = async (
  businessId: string,
  branchId: string,
  actor: TSmsActor,
  payload: TSettingsUpdate,
) => {
  requireAdmin(actor);
  const branch = await resolveBranchAccess(businessId, branchId, actor);
  const current = normalizeBranchSMSSettings(branch.smsSettings);

  const next = normalizeBranchSMSSettings({
    ...current,
    ...(payload.enabled !== undefined ? { enabled: payload.enabled } : {}),
    ...(payload.maskingSender !== undefined ? { maskingSender: payload.maskingSender } : {}),
    ...(payload.reminderDayOfMonth !== undefined ? { reminderDayOfMonth: payload.reminderDayOfMonth } : {}),
    ...(payload.reminderHour !== undefined ? { reminderHour: payload.reminderHour } : {}),
    ...(payload.birthdayHour !== undefined ? { birthdayHour: payload.birthdayHour } : {}),
    toggles: { ...current.toggles, ...(payload.toggles ?? {}) },
    updatedAt: new Date(),
    updatedBy: actor.userId ?? actor.staff?._id ?? null,
  });

  if (next.enabled && !next.maskingSender) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "Enter the approved sender name before turning SMS on",
    );
  }

  const updated = await BranchRepository.updateById(branchId, { smsSettings: next });
  if (!updated) {
    throw new AppError(StatusCodes.INTERNAL_SERVER_ERROR, "Failed to update SMS settings");
  }

  const changes: Record<string, unknown> = {};
  if (current.enabled !== next.enabled) changes.enabled = `${current.enabled}->${next.enabled}`;
  if (current.maskingSender !== next.maskingSender) changes.sender = `${current.maskingSender ?? "none"}->${next.maskingSender ?? "none"}`;
  for (const key of Object.keys(next.toggles) as Array<keyof TBranchSMSAutoToggles>) {
    if (current.toggles[key] !== next.toggles[key]) changes[key] = `${current.toggles[key]}->${next.toggles[key]}`;
  }
  if (current.reminderDayOfMonth !== next.reminderDayOfMonth) changes.reminderDay = `${current.reminderDayOfMonth}->${next.reminderDayOfMonth}`;
  if (current.reminderHour !== next.reminderHour) changes.reminderHour = `${current.reminderHour}->${next.reminderHour}`;
  if (current.birthdayHour !== next.birthdayHour) changes.birthdayHour = `${current.birthdayHour}->${next.birthdayHour}`;
  smsLog.info("settings changed", {
    branchId,
    by: actorLabel(actor),
    changes: Object.keys(changes).length ? changes : "nothing",
    nowEnabled: next.enabled,
    nowOn: (Object.keys(next.toggles) as Array<keyof TBranchSMSAutoToggles>).filter((k) => next.toggles[k]),
  });
  return buildSettingsSnapshot(updated);
};

// ───────────────────────────── planning (the "don't waste SMS" checks) ─────────────────────────────

const SKIP = {
  noPhone: "No phone number",
  badPhone: "Not a valid Bangladesh mobile number",
  missing: (keys: string[]) => `Missing value: ${keys.join(", ")}`,
  alreadySent: "Already sent before",
  duplicate: "Same number and same message already in this send",
  inactiveNotAllowed: "Only the owner or an admin can message inactive members",
  tooLong: (maxUnits: number, units: number, unicode: boolean) =>
    maxUnits <= 1
      ? unicode
        ? `Too long for 1 SMS: this member's name is not English, so only ${singleSmsLimit(true)} characters fit`
        : `Too long for 1 SMS with this member's name (${singleSmsLimit(false)} characters maximum)`
      : `Would cost ${units} credits (limit is ${maxUnits}), so it was not sent`,
};

const planRows = async (
  branchId: string,
  templateText: string,
  candidates: TCandidate[],
  options: { checkDedupe: boolean; /** most credits one message may cost */ maxUnits: number },
): Promise<TRow[]> => {
  let alreadySent = new Set<string>();
  if (options.checkDedupe) {
    const keys = candidates.map((c) => c.dedupeKey).filter((k): k is string => Boolean(k));
    if (keys.length > 0) {
      const found = await SmsHistory.find({
        branchId: new Types.ObjectId(branchId),
        dedupeKey: { $in: keys },
      })
        .select("dedupeKey")
        .lean();
      alreadySent = new Set(found.map((f) => String(f.dedupeKey)));
    }
  }

  const seen = new Set<string>();
  return candidates.map((candidate): TRow => {
    const rawContact = candidate.member.contact;
    const phone = normalizeBangladeshPhone(rawContact);
    const rendered = candidate.text
      ? { text: candidate.text, missing: [] as string[] }
      : renderSmsText(templateText, candidate.values);
    const base = {
      candidate,
      phone,
      text: rendered.text,
      unicode: detectUnicode(rendered.text),
      units: 0,
    };
    const skip = (reason: string): TRow => ({ ...base, status: "skipped", reason });

    if (!rawContact?.trim()) return skip(SKIP.noPhone);
    if (!phone) return skip(SKIP.badPhone);
    if (rendered.missing.length > 0) return skip(SKIP.missing(rendered.missing));
    if (candidate.dedupeKey && alreadySent.has(candidate.dedupeKey)) return skip(SKIP.alreadySent);

    const units = estimateSmsUnits(rendered.text);
    if (units > options.maxUnits) {
      return {
        ...base,
        status: "skipped",
        reason: SKIP.tooLong(options.maxUnits, units, base.unicode),
        creditLimitSkip: true,
      };
    }

    const batchKey = `${phone}|${rendered.text}`;
    if (seen.has(batchKey)) return skip(SKIP.duplicate);
    seen.add(batchKey);

    return { ...base, units, status: "ready" };
  });
};

const summarizeRows = (rows: TRow[], balance: TSmsBalanceSnapshot) => {
  const ready = rows.filter((r) => r.status === "ready");
  const skipped = rows.filter((r) => r.status === "skipped");
  const requiredUnits = ready.reduce((total, r) => total + r.units, 0);
  const availableBalance = Math.max(Number(balance.maskingBalance || 0), 0);
  const insufficientBalance = requiredUnits > availableBalance;

  const breakdown = new Map<string, number>();
  skipped.forEach((r) => breakdown.set(r.reason ?? "Skipped", (breakdown.get(r.reason ?? "Skipped") ?? 0) + 1));

  return {
    totalRecipients: rows.length,
    readyRecipients: ready.length,
    skippedRecipients: skipped.length,
    requiredUnits,
    availableBalance,
    remainingBalance: Math.max(availableBalance - requiredUnits, 0),
    insufficientBalance,
    canSend: ready.length > 0 && !insufficientBalance,
    needsConfirmation: ready.length >= LARGE_SEND_THRESHOLD,
    unicodeRecipients: ready.filter((r) => r.unicode).length,
    skippedBreakdown: Array.from(breakdown, ([reason, count]) => ({ reason, count })),
  };
};

// ───────────────────────────── candidates ─────────────────────────────

const loadMembers = (filter: Record<string, unknown>) =>
  MemberRepository.findMany(filter, { select: MEMBER_SELECT }).lean() as unknown as Promise<
    Array<TMember & { _id: Types.ObjectId }>
  >;

const buildDueCandidates = async (
  branch: TBranch & { _id?: Types.ObjectId },
  targetDate: Date,
): Promise<TCandidate[]> => {
  const members = await loadMembers({ branchId: new Types.ObjectId(String(branch._id)), isActive: true });
  const candidates: TCandidate[] = [];

  for (const member of members) {
    const billing = reconcileMemberBillingState(member, branch, targetDate);
    if (!billing.monthlyFeeAmount || billing.currentDueAmount <= 0) continue;

    const label = formatDueMonthLabel(targetDate, billing.overdueMonths);
    const total = normalizeMoney(billing.currentDueAmount ?? 0);
    candidates.push({
      member,
      values: {
        Member_Name: member.fullName,
        Due_Period: label,
        Due_Amount: formatEnglishAmount(total),
      },
      due: { label, months: billing.overdueMonths, total },
      dedupeKey: `due:${member._id}:${getDhakaYear(targetDate)}-${getDhakaMonth(targetDate)}`,
    });
  }
  return candidates;
};

const buildMemberCandidates = (
  members: Array<TMember & { _id: Types.ObjectId }>,
  values: (member: TMember) => Record<string, string>,
): TCandidate[] => members.map((member) => ({ member, values: values(member) }));

const modeOf = (actor: TSmsActor): TSmsSendMode => (actor.system ? "auto" : "manual");

// ───────────────────────────── manual plan (preview + send share this) ─────────────────────────────

type TManualPlan = {
  branch: TBranch & { _id?: Types.ObjectId };
  settings: TBranchSMSSettings;
  templateKey: TSmsMessageKind;
  audience: TSmsAudience;
  templateText: string;
  rows: TRow[];
  holidayId?: string;
  dueDurationCounts?: TSmsDueDurationCounts;
  dueDuration?: TSmsDueDuration;
  targetDate: Date;
};

const buildManualPlan = async (
  businessId: string,
  branchId: string,
  actor: TSmsActor,
  payload: TSmsSendPayload,
): Promise<TManualPlan> => {
  const branch = await resolveBranchAccess(businessId, branchId, actor);
  const settings = normalizeBranchSMSSettings(branch.smsSettings);

  if (!settings.enabled) {
    throw new AppError(StatusCodes.BAD_REQUEST, "SMS is turned off for this branch");
  }
  if (!settings.maskingSender) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Sender name is not set for this branch");
  }

  const branchObjectId = new Types.ObjectId(branchId);
  const targetDate = payload.targetDate ? new Date(payload.targetDate) : new Date();
  const isAdmin = Boolean(actor.isAdmin || actor.userId || actor.system);

  if (payload.kind === "dueReminder") {
    const all = await buildDueCandidates(branch, targetDate);
    const duration = payload.dueDuration ?? "allDue";
    const chosen = all.filter((c) => matchesDueDuration(c.due?.months ?? 0, duration));
    const text = SMS_TEMPLATES.dueReminder.text;
    return {
      branch, settings, templateKey: "dueReminder", audience: "due", templateText: text,
      rows: await planRows(branchId, text, chosen.map((c) => ({ ...c, dedupeKey: undefined })), { checkDedupe: false, maxUnits: SMS_MAX_CREDITS_TEMPLATE }),
      dueDurationCounts: buildDueDurationCounts(all),
      dueDuration: duration,
      targetDate,
    };
  }

  if (payload.kind === "holiday") {
    if (!payload.holidayId || !Types.ObjectId.isValid(payload.holidayId)) {
      throw new AppError(StatusCodes.BAD_REQUEST, "Choose a holiday notice to send");
    }
    const holiday = await SmsHoliday.findOne({ _id: payload.holidayId, branchId: branchObjectId }).lean();
    if (!holiday) throw new AppError(StatusCodes.NOT_FOUND, "Holiday notice not found");
    if (holiday.status === "sent") {
      throw new AppError(StatusCodes.CONFLICT, "This holiday notice was already sent");
    }
    if (holiday.includeInactive && !isAdmin) {
      throw new AppError(StatusCodes.FORBIDDEN, SKIP.inactiveNotAllowed);
    }

    const members = await loadMembers({
      branchId: branchObjectId,
      ...(holiday.includeInactive ? {} : { isActive: true }),
    });
    const values = {
      Holiday_Date: formatHolidayDates(holiday.fromDate, holiday.toDate),
      Reason: holiday.reason,
    };
    const text = SMS_TEMPLATES.holiday.text;
    return {
      branch, settings, templateKey: "holiday",
      audience: holiday.includeInactive ? "all" : "active",
      templateText: text,
      rows: await planRows(branchId, text, buildMemberCandidates(members, () => values), { checkDedupe: false, maxUnits: SMS_MAX_CREDITS_TEMPLATE }),
      holidayId: String(holiday._id),
      targetDate,
    };
  }

  // custom message
  const message = sanitizeSmsText(payload.message ?? "");
  if (!message) throw new AppError(StatusCodes.BAD_REQUEST, "Write a message first");
  if (!isPlainSmsText(message)) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Messages must use English letters, numbers and normal punctuation only");
  }
  if (message.length > CUSTOM_MESSAGE_MAX_CHARS) {
    throw new AppError(StatusCodes.BAD_REQUEST, `Message is too long (maximum ${CUSTOM_MESSAGE_MAX_CHARS} characters)`);
  }
  const unknown = Array.from(message.matchAll(/\{(\w+)\}/g)).map((m) => m[1]!).filter((k) => k !== "Member_Name");
  if (unknown.length > 0) {
    throw new AppError(StatusCodes.BAD_REQUEST, `Unknown placeholder: {${unknown[0]}}. Only {Member_Name} can be used.`);
  }

  const audience = payload.audience && payload.audience !== "due" ? payload.audience : "selected";
  if ((audience === "inactive" || audience === "all") && !isAdmin) {
    throw new AppError(StatusCodes.FORBIDDEN, SKIP.inactiveNotAllowed);
  }

  let members: Array<TMember & { _id: Types.ObjectId }>;
  if (audience === "selected") {
    const ids = (payload.memberIds ?? []).filter((id) => Types.ObjectId.isValid(id));
    if (ids.length === 0) throw new AppError(StatusCodes.BAD_REQUEST, "Choose at least one member");
    members = await loadMembers({ branchId: branchObjectId, _id: { $in: ids.map((id) => new Types.ObjectId(id)) } });
    if (!isAdmin) members = members.filter((m) => m.isActive !== false);
  } else if (audience === "active") {
    members = await loadMembers({ branchId: branchObjectId, isActive: true });
  } else if (audience === "inactive") {
    members = await loadMembers({ branchId: branchObjectId, isActive: false });
  } else {
    members = await loadMembers({ branchId: branchObjectId });
  }

  return {
    branch, settings, templateKey: "custom", audience, templateText: message,
    rows: await planRows(branchId, message, buildMemberCandidates(members, (m) => ({ Member_Name: m.fullName })), { checkDedupe: false, maxUnits: SMS_MAX_CREDITS_CUSTOM }),
    targetDate,
  };
};

// ───────────────────────────── executing a plan ─────────────────────────────

type TExecuteInput = {
  branchId: string;
  senderName: string;
  rows: TRow[];
  templateKey: TSmsMessageKind;
  audience: TSmsAudience;
  sendMode: TSmsSendMode;
  actor?: TSmsActor;
  holidayId?: string;
  /** Save skipped rows to history (manual sends only, so the admin can see why). */
  saveSkipped: boolean;
  /** Manual sends throw on a blocking problem; automatic sends record it and move on. */
  throwOnBlock: boolean;
  requestId?: string;
};

const buildHistoryRow = (
  input: TExecuteInput,
  requestId: string,
  row: TRow,
  status: TSmsHistoryStatus,
  reason: string | undefined,
  providerReference: string | undefined,
  dedupeKey: string | undefined,
): TSmsHistory => ({
  requestId,
  branchId: new Types.ObjectId(input.branchId),
  memberId: row.candidate.member._id ? new Types.ObjectId(String(row.candidate.member._id)) : null,
  memberName: row.candidate.member.fullName,
  recipientPhone: row.phone,
  templateKey: input.templateKey,
  renderedMessage: row.text || "-",
  audience: input.audience,
  sendMode: input.sendMode,
  messageType: row.unicode ? "unicode" : "text",
  status,
  reason,
  units: status === "skipped" ? 0 : row.units,
  dedupeKey,
  holidayId: input.holidayId ? new Types.ObjectId(input.holidayId) : null,
  dueMonthLabel: row.candidate.due?.label,
  overdueMonths: row.candidate.due?.months,
  totalDueAmount: row.candidate.due?.total,
  requestedByUserId: input.actor?.userId ?? null,
  requestedByStaffId: input.actor?.staff?._id ?? null,
  provider: "fastsmsbd",
  providerReference,
});

const saveHistory = async (rows: TSmsHistory[]) => {
  if (rows.length === 0) return;
  try {
    await SmsRepository.createMany(rows);
    smsLog.info("history saved", { requestId: rows[0]?.requestId, rows: rows.length });
  } catch (error) {
    // The SMS may already be out at this point, so never fail the request over history.
    smsLog.error("history could not be fully saved", {
      requestId: rows[0]?.requestId,
      rows: rows.length,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

const executeRows = async (input: TExecuteInput) => {
  const requestId = input.requestId ?? randomUUID();
  const ready = input.rows.filter((r) => r.status === "ready");
  const skipped = input.rows.filter((r) => r.status === "skipped");
  // Manual sends keep every skipped row so the admin can see why. Automatic sends only
  // keep rows skipped for the credit limit, so a cost problem is never silent.
  const skippedHistory = skipped
    .filter((r) => input.saveSkipped || r.creditLimitSkip)
    .map((r) => buildHistoryRow(input, requestId, r, "skipped", r.reason, undefined, undefined));

  const skipBreakdown = new Map<string, number>();
  skipped.forEach((r) => skipBreakdown.set(r.reason ?? "Skipped", (skipBreakdown.get(r.reason ?? "Skipped") ?? 0) + 1));
  smsLog.info("send planned", {
    requestId,
    branchId: input.branchId,
    template: input.templateKey,
    audience: input.audience,
    mode: input.sendMode,
    by: actorLabel(input.actor),
    total: input.rows.length,
    ready: ready.length,
    skipped: skipped.length,
    skippedWhy: skipBreakdown.size ? Object.fromEntries(skipBreakdown) : undefined,
    credits: ready.reduce((total, r) => total + r.units, 0),
    maxCreditsOneMessage: ready.reduce((max, r) => Math.max(max, r.units), 0),
  });
  skipped
    .filter((r) => r.creditLimitSkip)
    .forEach((r) =>
      smsLog.warn("message skipped: credit limit", {
        requestId,
        to: maskPhone(r.phone),
        length: r.text.length,
        unicode: r.unicode,
        why: r.reason,
      }),
    );

  if (ready.length === 0) {
    smsLog.warn("nothing to send", { requestId, mode: input.sendMode, template: input.templateKey });
    await saveHistory(skippedHistory);
    if (input.throwOnBlock) {
      throw new AppError(StatusCodes.BAD_REQUEST, "Nobody to send to. Everyone was skipped (no phone, invalid number or duplicate).");
    }
    return { requestId, sent: 0, failed: 0, skipped: skipped.length, dryRun: config.sms.dry_run !== false };
  }

  const balance = await SmsProvider.getBalance();
  const required = ready.reduce((total, r) => total + r.units, 0);
  const available = Math.max(Number(balance.maskingBalance || 0), 0);

  if (required > available) {
    const reason = `Not enough SMS credits (need ${required}, have ${available})`;
    smsLog.warn("blocked: balance too low", { requestId, need: required, have: available, mode: input.sendMode });
    if (input.throwOnBlock) throw new AppError(StatusCodes.BAD_REQUEST, reason);
    await saveHistory([
      ...skippedHistory,
      ...ready.map((r) => buildHistoryRow(input, requestId, r, "failed", reason, undefined, undefined)),
    ]);
    return { requestId, sent: 0, failed: ready.length, skipped: skipped.length, dryRun: balance.dryRun };
  }

  smsLog.info("balance ok, calling provider", { requestId, need: required, have: available, dryRun: balance.dryRun });
  const outcome = await SmsProvider.sendMessages(
    ready.map((r) => ({ phone: r.phone as string, text: r.text, unicode: r.unicode, units: r.units })),
    requestId,
    input.senderName,
  );

  let sent = 0;
  let failed = 0;
  const sentHistory = ready.map((row, index) => {
    const result = outcome.results[index] ?? { status: "failed" as const, reason: "No confirmation from provider" };
    const ok = result.status === "sent";
    if (ok) sent += 1;
    else failed += 1;
    return buildHistoryRow(
      input,
      requestId,
      row,
      ok ? (outcome.dryRun ? "simulated" : "sent") : "failed",
      ok ? undefined : result.reason,
      outcome.providerReference,
      ok && !outcome.dryRun ? row.candidate.dedupeKey : undefined,
    );
  });

  await saveHistory([...skippedHistory, ...sentHistory]);
  await cacheService.deleteCache(BALANCE_CACHE_KEY).catch(() => {});

  const failureWhy = new Map<string, number>();
  ready.forEach((_row, index) => {
    const result = outcome.results[index];
    if (result?.status !== "sent") {
      const key = result?.reason ?? "No confirmation from provider";
      failureWhy.set(key, (failureWhy.get(key) ?? 0) + 1);
    }
  });
  // One line per recipient (first 25), so a one-member send is fully traceable.
  ready.slice(0, 25).forEach((row, index) => {
    const result = outcome.results[index];
    smsLog.info("recipient result", {
      requestId,
      to: maskPhone(row.phone),
      credits: row.units,
      unicode: row.unicode,
      length: row.text.length,
      status: result?.status === "sent" ? (outcome.dryRun ? "simulated" : "sent") : "failed",
      why: result?.status === "sent" ? undefined : (result?.reason ?? "No confirmation from provider"),
    });
  });
  smsLog.info("send finished", {
    requestId,
    mode: input.sendMode,
    template: input.templateKey,
    sent,
    failed,
    skipped: skipped.length,
    creditsAccepted: ready.reduce(
      (total, row, index) => total + (outcome.results[index]?.status === "sent" ? row.units : 0),
      0,
    ),
    dryRun: outcome.dryRun,
    failedWhy: failureWhy.size ? Object.fromEntries(failureWhy) : undefined,
  });

  return { requestId, sent, failed, skipped: skipped.length, dryRun: outcome.dryRun };
};

// ───────────────────────────── preview / send (manual) ─────────────────────────────

const toRowView = (row: TRow) => ({
  memberId: String(row.candidate.member._id ?? ""),
  memberName: row.candidate.member.fullName,
  memberIdentifier: row.candidate.member.memberId,
  phone: row.phone,
  message: row.text,
  units: row.units,
  status: row.status,
  reason: row.reason,
});

const previewSms = async (
  businessId: string,
  branchId: string,
  actor: TSmsActor,
  payload: TSmsSendPayload,
) => {
  const plan = await buildManualPlan(businessId, branchId, actor, payload);
  const balance = await SmsProvider.getBalance();
  const ready = plan.rows.filter((r) => r.status === "ready");

  return {
    templateKey: plan.templateKey,
    audience: plan.audience,
    dueDuration: plan.dueDuration,
    dueDurationCounts: plan.dueDurationCounts,
    balance,
    summary: summarizeRows(plan.rows, balance),
    sampleMessage: ready[0]?.text ?? plan.rows[0]?.text ?? "",
    recipients: ready.slice(0, 50).map(toRowView),
    skipped: plan.rows.filter((r) => r.status === "skipped").slice(0, 200).map(toRowView),
  };
};

const sendSms = async (
  businessId: string,
  branchId: string,
  actor: TSmsActor,
  payload: TSmsSendPayload,
) => {
  smsLog.info("manual send requested", {
    branchId,
    by: actorLabel(actor),
    kind: payload.kind,
    audience: payload.audience,
    members: payload.memberIds?.length,
    messageLength: payload.message?.length,
  });
  let plan: TManualPlan;
  try {
    plan = await buildManualPlan(businessId, branchId, actor, payload);
  } catch (error) {
    smsLog.warn("manual send refused", {
      branchId,
      by: actorLabel(actor),
      why: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  const result = await executeRows({
    branchId,
    senderName: plan.settings.maskingSender as string,
    rows: plan.rows,
    templateKey: plan.templateKey,
    audience: plan.audience,
    sendMode: modeOf(actor),
    actor,
    holidayId: plan.holidayId,
    saveSkipped: true,
    throwOnBlock: true,
  });

  // If nothing at all went out, keep the notice as a draft so it can be sent again.
  if (plan.holidayId && result.sent > 0) {
    await SmsHoliday.updateOne(
      { _id: plan.holidayId },
      { $set: { status: "sent", sentAt: new Date(), requestId: result.requestId, sentCount: result.sent, failedCount: result.failed } },
    );
  }

  return {
    ...result,
    status: result.dryRun ? "simulated" : "sent",
    message: result.dryRun
      ? `Test mode: ${result.sent} message(s) simulated, nothing was really sent`
      : `${result.sent} sent, ${result.failed} failed, ${result.skipped} skipped`,
  };
};

const sendTest = async (
  businessId: string,
  branchId: string,
  actor: TSmsActor,
  input: { templateKey: TSmsTemplateKey; phone: string },
) => {
  requireAdmin(actor);
  smsLog.info("test message requested", { branchId, by: actorLabel(actor), template: input.templateKey, to: maskPhone(input.phone) });
  const branch = await resolveBranchAccess(businessId, branchId, actor);
  const settings = normalizeBranchSMSSettings(branch.smsSettings);
  if (!settings.maskingSender) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Set the sender name first");
  }
  const phone = normalizeBangladeshPhone(input.phone);
  if (!phone) throw new AppError(StatusCodes.BAD_REQUEST, "Enter a valid Bangladesh mobile number");

  const template = SMS_TEMPLATES[input.templateKey];
  const rows = await planRows(
    branchId,
    template.text,
    [{ member: { fullName: "Test message", contact: phone, isActive: true }, values: template.sample }],
    { checkDedupe: false, maxUnits: SMS_MAX_CREDITS_TEMPLATE },
  );
  const result = await executeRows({
    branchId,
    senderName: settings.maskingSender,
    rows,
    templateKey: input.templateKey,
    audience: "selected",
    sendMode: "manual",
    actor,
    saveSkipped: true,
    throwOnBlock: true,
  });
  return {
    ...result,
    message: result.dryRun
      ? "Test mode is on, so nothing was really sent"
      : result.failed > 0
        ? "The provider rejected the test message. See History for the reason."
        : `Test message sent to ${phone}`,
  };
};

// ───────────────────────────── due members list (for the Send page counts) ─────────────────────────────

const listDueMembers = async (
  businessId: string,
  branchId: string,
  actor: TSmsActor,
  query: { targetDate?: Date; dueDuration?: TSmsDueDuration },
) => {
  const branch = await resolveBranchAccess(businessId, branchId, actor);
  const targetDate = query.targetDate ?? new Date();
  const all = await buildDueCandidates(branch, targetDate);
  const duration = query.dueDuration ?? "allDue";
  const chosen = all.filter((c) => matchesDueDuration(c.due?.months ?? 0, duration));
  return {
    dueDurationCounts: buildDueDurationCounts(all),
    total: chosen.length,
    members: chosen.slice(0, 100).map((c) => ({
      memberId: String(c.member._id),
      memberName: c.member.fullName,
      memberIdentifier: c.member.memberId,
      phone: normalizeBangladeshPhone(c.member.contact),
      dueMonthLabel: c.due?.label,
      overdueMonths: c.due?.months,
      totalDueAmount: c.due?.total,
    })),
  };
};

// ───────────────────────────── holidays ─────────────────────────────

const holidayView = (holiday: any) => ({
  id: String(holiday._id),
  fromDate: holiday.fromDate,
  toDate: holiday.toDate,
  reason: holiday.reason,
  includeInactive: holiday.includeInactive,
  status: holiday.status,
  sentAt: holiday.sentAt,
  sentCount: holiday.sentCount ?? 0,
  failedCount: holiday.failedCount ?? 0,
  previewMessage: renderSmsText(SMS_TEMPLATES.holiday.text, {
    Holiday_Date: formatHolidayDates(holiday.fromDate, holiday.toDate),
    Reason: holiday.reason,
  }).text,
});

const listHolidays = async (businessId: string, branchId: string, actor: TSmsActor) => {
  await resolveBranchAccess(businessId, branchId, actor);
  const holidays = await SmsHoliday.find({ branchId: new Types.ObjectId(branchId) })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
  return {
    reasons: HOLIDAY_REASONS,
    data: holidays.map(holidayView),
  };
};

const createHoliday = async (
  businessId: string,
  branchId: string,
  actor: TSmsActor,
  input: { fromDate: Date; toDate?: Date; reason: string; otherReason?: string; includeInactive?: boolean },
) => {
  await resolveBranchAccess(businessId, branchId, actor);

  const fromDate = new Date(input.fromDate);
  const toDate = new Date(input.toDate ?? input.fromDate);
  if (toDate < fromDate) {
    throw new AppError(StatusCodes.BAD_REQUEST, "The last day cannot be before the first day");
  }

  let reason = input.reason;
  if (reason === "Other") {
    reason = sanitizeSmsText(input.otherReason ?? "");
    if (!reason) throw new AppError(StatusCodes.BAD_REQUEST, "Write the reason for the holiday");
    if (!isPlainSmsText(reason) || reason.length > HOLIDAY_OTHER_REASON_MAX_CHARS || /[{}]/.test(reason)) {
      throw new AppError(
        StatusCodes.BAD_REQUEST,
        `Reason must be English text, up to ${HOLIDAY_OTHER_REASON_MAX_CHARS} characters`,
      );
    }
  } else if (!(HOLIDAY_REASONS as readonly string[]).includes(reason)) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Choose a valid reason");
  }

  const isAdmin = Boolean(actor.isAdmin || actor.userId);
  if (input.includeInactive && !isAdmin) {
    throw new AppError(StatusCodes.FORBIDDEN, SKIP.inactiveNotAllowed);
  }

  const holiday = await SmsHoliday.create({
    branchId: new Types.ObjectId(branchId),
    fromDate,
    toDate,
    reason,
    includeInactive: Boolean(input.includeInactive),
    status: "draft",
    createdByUserId: actor.userId ?? null,
    createdByStaffId: actor.staff?._id ?? null,
  });
  return holidayView(holiday.toObject());
};

const deleteHoliday = async (businessId: string, branchId: string, actor: TSmsActor, holidayId: string) => {
  await resolveBranchAccess(businessId, branchId, actor);
  if (!Types.ObjectId.isValid(holidayId)) throw new AppError(StatusCodes.BAD_REQUEST, "Invalid holiday");
  const result = await SmsHoliday.deleteOne({
    _id: holidayId,
    branchId: new Types.ObjectId(branchId),
    status: "draft",
  });
  if (result.deletedCount === 0) {
    throw new AppError(StatusCodes.NOT_FOUND, "Only draft holiday notices can be deleted");
  }
  return { id: holidayId };
};

// ───────────────────────────── history ─────────────────────────────

type THistoryQuery = {
  page?: string;
  limit?: string;
  status?: string;
  templateKey?: string;
  requestId?: string;
  searchTerm?: string;
};

const buildHistoryFilter = (branchId: string, query: THistoryQuery, extra: Record<string, unknown> = {}) => {
  const filter: Record<string, unknown> = { branchId: new Types.ObjectId(branchId), ...extra };
  if (query.status) filter.status = query.status;
  if (query.templateKey) filter.templateKey = query.templateKey;
  if (query.requestId) filter.requestId = query.requestId;
  if (query.searchTerm?.trim()) {
    const regex = new RegExp(query.searchTerm.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [{ memberName: regex }, { recipientPhone: regex }, { renderedMessage: regex }];
  }
  return filter;
};

const paging = (query: THistoryQuery, defaultLimit: number) => {
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query.limit) || defaultLimit, 1), 200);
  return { page, limit, skip: (page - 1) * limit };
};

const listHistory = async (
  businessId: string,
  branchId: string,
  actor: TSmsActor,
  query: THistoryQuery,
  memberId?: string,
) => {
  await resolveBranchAccess(businessId, branchId, actor);
  const filter = buildHistoryFilter(
    branchId,
    query,
    memberId ? { memberId: new Types.ObjectId(memberId) } : {},
  );
  const { page, limit, skip } = paging(query, 20);

  const [items, total] = await Promise.all([
    SmsRepository.findMany(filter, { sort: { createdAt: -1 }, skip, limit }).lean(),
    SmsRepository.count(filter),
  ]);
  return { meta: { page, limit, total }, data: items };
};

const listBatches = async (
  businessId: string,
  branchId: string,
  actor: TSmsActor,
  query: THistoryQuery,
) => {
  await resolveBranchAccess(businessId, branchId, actor);
  const { page, limit, skip } = paging(query, 15);
  const match = buildHistoryFilter(branchId, { templateKey: query.templateKey });
  const ok = ["sent", "simulated"];

  const [result] = await SmsHistory.aggregate([
    { $match: match },
    { $sort: { createdAt: 1 } },
    {
      $group: {
        _id: "$requestId",
        createdAt: { $first: "$createdAt" },
        templateKey: { $first: "$templateKey" },
        sendMode: { $first: "$sendMode" },
        audience: { $first: "$audience" },
        sampleMessage: { $first: "$renderedMessage" },
        requestedByStaffId: { $first: "$requestedByStaffId" },
        requestedByUserId: { $first: "$requestedByUserId" },
        total: { $sum: 1 },
        sent: { $sum: { $cond: [{ $in: ["$status", ok] }, 1, 0] } },
        failed: { $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] } },
        retryable: {
          $sum: { $cond: [{ $and: [{ $eq: ["$status", "failed"] }, { $eq: [{ $ifNull: ["$retriedAt", null] }, null] }] }, 1, 0] },
        },
        skipped: { $sum: { $cond: [{ $in: ["$status", ["skipped", "blocked"]] }, 1, 0] } },
        credits: { $sum: { $cond: [{ $in: ["$status", ok] }, "$units", 0] } },
        simulated: { $sum: { $cond: [{ $eq: ["$status", "simulated"] }, 1, 0] } },
      },
    },
    { $sort: { createdAt: -1 } },
    {
      $facet: {
        data: [{ $skip: skip }, { $limit: limit }],
        total: [{ $count: "count" }],
      },
    },
  ]);

  return {
    meta: { page, limit, total: result?.total?.[0]?.count ?? 0 },
    data: (result?.data ?? []).map((b: any) => ({ ...b, requestId: b._id, _id: undefined })),
  };
};

const retryFailed = async (
  businessId: string,
  branchId: string,
  actor: TSmsActor,
  requestId: string,
) => {
  const branch = await resolveBranchAccess(businessId, branchId, actor);
  const settings = normalizeBranchSMSSettings(branch.smsSettings);
  if (!settings.enabled || !settings.maskingSender) {
    throw new AppError(StatusCodes.BAD_REQUEST, "SMS is turned off for this branch");
  }

  const failedRows = await SmsHistory.find({
    branchId: new Types.ObjectId(branchId),
    requestId,
    status: "failed",
    retriedAt: null,
    recipientPhone: { $ne: null },
  }).lean();
  if (failedRows.length === 0) {
    throw new AppError(StatusCodes.NOT_FOUND, "There are no failed messages to retry");
  }

  smsLog.info("retry requested", { branchId, by: actorLabel(actor), originalRequestId: requestId, failedRows: failedRows.length });
  const first = failedRows[0]!;
  const candidates: TCandidate[] = failedRows.map((row) => ({
    member: {
      _id: row.memberId ?? undefined,
      fullName: row.memberName,
      contact: row.recipientPhone ?? undefined,
      isActive: true,
    },
    values: {},
    text: row.renderedMessage,
    dedupeKey: undefined,
  }));
  const rows = await planRows(branchId, "", candidates, { checkDedupe: false, maxUnits: SMS_MAX_CREDITS_TEMPLATE });

  const result = await executeRows({
    branchId,
    senderName: settings.maskingSender,
    rows,
    templateKey: first.templateKey,
    audience: first.audience,
    sendMode: "manual",
    actor,
    holidayId: first.holidayId ? String(first.holidayId) : undefined,
    saveSkipped: false,
    throwOnBlock: true,
  });

  await SmsHistory.updateMany(
    { _id: { $in: failedRows.map((r) => r._id) } },
    { $set: { retriedAt: new Date() } },
  );

  return {
    ...result,
    message: result.dryRun
      ? "Test mode is on, so nothing was really sent"
      : `${result.sent} sent, ${result.failed} failed again`,
  };
};

// ───────────────────────────── automatic messages ─────────────────────────────

type TAutoKey = "welcome" | "paymentConfirmation" | "membershipExpired" | "birthday" | "dueReminder";

const loadAutoBranch = async (branchId: string, key: TAutoKey) => {
  const branch = await BranchRepository.findById(branchId);
  if (!branch) return null;
  const settings = normalizeBranchSMSSettings(branch.smsSettings);
  if (!settings.enabled) return null; // SMS is off for this branch: stay completely silent
  if (!settings.maskingSender) {
    smsLog.warn("automatic message ignored: no sender set", { branchId, message: key });
    return null;
  }
  if (!settings.toggles[key]) {
    smsLog.info("automatic message ignored: switch is off", { branchId, message: key });
    return null;
  }
  smsLog.info("automatic message triggered", { branchId, message: key });
  return { branch, settings };
};

const runAutoBatch = async (
  branchId: string,
  settings: TBranchSMSSettings,
  key: TAutoKey,
  candidates: TCandidate[],
) => {
  if (candidates.length === 0) return null;
  const rows = await planRows(branchId, SMS_TEMPLATES[key].text, candidates, { checkDedupe: true, maxUnits: SMS_MAX_CREDITS_TEMPLATE });
  return executeRows({
    branchId,
    senderName: settings.maskingSender as string,
    rows,
    templateKey: key,
    audience: key === "dueReminder" ? "due" : "selected",
    sendMode: "auto",
    actor: { system: true },
    saveSkipped: false,
    throwOnBlock: false,
  });
};

/** Fire-and-forget wrapper: a failed SMS must never break the action that triggered it. */
const safely = async (label: string, branchId: string, task: () => Promise<unknown>) => {
  try {
    await task();
  } catch (error) {
    smsLog.error("automatic message crashed", {
      branchId,
      label,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

const notifyWelcome = (branchId: string, member: TMemberLite) =>
  safely("welcome", branchId, async () => {
    const auto = await loadAutoBranch(branchId, "welcome");
    if (!auto || !member._id) return;
    await runAutoBatch(branchId, auto.settings, "welcome", [
      { member, values: { Member_Name: member.fullName }, dedupeKey: `welcome:${member._id}` },
    ]);
  });

const notifyPayment = (
  branchId: string,
  member: TMemberLite,
  paidTotal: number,
  paymentId: string,
) =>
  safely("payment", branchId, async () => {
    if (!(paidTotal > 0) || !member._id) return;
    const auto = await loadAutoBranch(branchId, "paymentConfirmation");
    if (!auto) return;
    await runAutoBatch(branchId, auto.settings, "paymentConfirmation", [
      {
        member,
        values: { Member_Name: member.fullName, Paid_Amount: formatEnglishAmount(normalizeMoney(paidTotal)) },
        dedupeKey: `payment:${paymentId}`,
      },
    ]);
  });

const notifyMembershipExpired = (branchId: string, member: TMemberLite, anchorDate: Date) =>
  safely("expired", branchId, async () => {
    const auto = await loadAutoBranch(branchId, "membershipExpired");
    if (!auto || !member._id) return;
    await runAutoBatch(branchId, auto.settings, "membershipExpired", [
      {
        member,
        values: { Member_Name: member.fullName },
        dedupeKey: `expired:${member._id}:${getDhakaDateString(anchorDate)}`,
      },
    ]);
  });

/** Claim today's run first, so a crash or a retry can never send the same batch twice. */
const claimDailyRun = async (
  branchId: string,
  field: "lastAutoReminderRunDate" | "lastBirthdayRunDate",
  today: string,
) => {
  const result = await Branch.updateOne(
    { _id: branchId, [`smsSettings.${field}`]: { $ne: today } },
    { $set: { [`smsSettings.${field}`]: today } },
  );
  return result.modifiedCount === 1;
};

const daysInCurrentDhakaMonth = () => new Date(getDhakaYear(), getDhakaMonth(), 0).getDate();

const runDueRemindersForBranch = async (branchId: string) => {
  const auto = await loadAutoBranch(branchId, "dueReminder");
  if (!auto) return;
  const { branch, settings } = auto;

  const today = getDhakaDateString();
  const day = Math.min(settings.reminderDayOfMonth, daysInCurrentDhakaMonth());
  if (getDhakaDayOfMonth() !== day || getDhakaHour() < settings.reminderHour) return;
  if (!(await claimDailyRun(branchId, "lastAutoReminderRunDate", today))) return;

  const candidates = await buildDueCandidates(branch, new Date());
  const result = await runAutoBatch(branchId, settings, "dueReminder", candidates);
  smsLog.info("due reminder run finished", { branchId, candidates: candidates.length, sent: result?.sent, failed: result?.failed, skipped: result?.skipped });
};

const runBirthdaysForBranch = async (branchId: string) => {
  const auto = await loadAutoBranch(branchId, "birthday");
  if (!auto) return;
  const { settings } = auto;

  const today = getDhakaDateString();
  if (getDhakaHour() < settings.birthdayHour) return;
  if (!(await claimDailyRun(branchId, "lastBirthdayRunDate", today))) return;

  const month = getDhakaMonth();
  const day = getDhakaDayOfMonth();
  const year = getDhakaYear();
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  // A 29 Feb birthday is celebrated on 28 Feb in years without a 29 Feb.
  const matchesToday = (m: number, d: number) =>
    (m === month && d === day) || (!isLeap && month === 2 && day === 28 && m === 2 && d === 29);

  const members = await loadMembers({
    branchId: new Types.ObjectId(branchId),
    isActive: true,
    dateOfBirth: { $ne: null },
    contact: { $exists: true, $ne: "" },
  });
  const candidates: TCandidate[] = members
    .filter((member) => {
      if (!member.dateOfBirth) return false;
      const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Dhaka", month: "numeric", day: "numeric" })
        .formatToParts(new Date(member.dateOfBirth));
      const m = Number(parts.find((p) => p.type === "month")?.value);
      const d = Number(parts.find((p) => p.type === "day")?.value);
      return matchesToday(m, d);
    })
    .map((member) => ({
      member,
      values: { Member_Name: member.fullName },
      dedupeKey: `birthday:${member._id}:${year}`,
    }));

  const result = await runAutoBatch(branchId, settings, "birthday", candidates);
  smsLog.info("birthday run finished", { branchId, candidates: candidates.length, sent: result?.sent, failed: result?.failed, skipped: result?.skipped });
};

const runAutomationSweep = async () => {
  const locked = await SchedulerLockService.tryAcquireLock(SMS_LOCK_NAME, SMS_LOCK_DURATION_MS);
  if (!locked) return;

  const branches = await BranchRepository.findMany(
    { isActive: true, "smsSettings.enabled": true },
    { select: "_id" },
  ).lean();

  if (branches.length > 0) {
    smsLog.info("automation sweep", { branchesWithSmsOn: branches.length });
  }
  for (const branch of branches) {
    const branchId = String(branch._id);
    await safely("due-reminder", branchId, () => runDueRemindersForBranch(branchId));
    await safely("birthday", branchId, () => runBirthdaysForBranch(branchId));
  }
};

const startAutomationScheduler = () => {
  if (schedulerHandle) return;
  schedulerHandle = setInterval(() => void runAutomationSweep(), SCHEDULER_INTERVAL_MS);
  void runAutomationSweep();
  smsLog.info("scheduler started", { intervalMinutes: SCHEDULER_INTERVAL_MS / 60000 });
};

export const SmsService = {
  getBalance,
  getSettings,
  updateSettings,
  listDueMembers,
  previewSms,
  sendSms,
  sendTest,
  listHolidays,
  createHoliday,
  deleteHoliday,
  listHistory,
  listBatches,
  retryFailed,
  notifyWelcome,
  notifyPayment,
  notifyMembershipExpired,
  startAutomationScheduler,
};
