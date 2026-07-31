import { randomUUID } from "crypto";
import { StatusCodes } from "http-status-codes";
import { Types } from "mongoose";
import config from "../../config";
import AppError from "../../errors/AppError";
import { logger } from "../../logger/logger";
import { normalizeBangladeshPhone } from "../../utils/bangladeshPhone";
import {
  getDhakaDateString,
  getDhakaDayOfMonth,
  formatEnglishMonth,
  formatEnglishAmount,
} from "../../utils/dhakaTime";
import { normalizeBranchSMSSettings, TBranch } from "../branch/branch.interface";
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
  TSmsBalanceBucket,
  TSmsBalanceSnapshot,
  TSmsDeliveryMode,
  TSmsDueDuration,
  TSmsDueDurationCounts,
  TSmsHistory,
  TSmsMessageType,
  TSmsMessageTypeSummary,
  TSmsPreviewSummary,
  TSmsRecipientPreview,
  TSmsSendMode,
  TSmsTemplateCategory,
} from "./sms.interface";
import { SmsProvider } from "./sms.provider";
import { SmsRepository } from "./sms.repository";

type TSmsActor = {
  userId?: Types.ObjectId;
  staff?: TStaff & { _id?: Types.ObjectId };
  system?: boolean;
};

type TSmsPreviewPayload = {
  audience?: TSmsAudience;
  memberIds?: string[];
  template?: string;
  templateCategory?: TSmsTemplateCategory;
  deliveryMode?: TSmsDeliveryMode;
  dueDuration?: TSmsDueDuration;
  targetDate?: Date;
};

type TResolvedRecipientMember = Pick<
  TMember,
  | "fullName"
  | "memberId"
  | "contact"
  | "currentDueAmount"
  | "nextPaymentDate"
  | "isActive"
  | "isCustomMonthlyFee"
  | "customMonthlyFeeAmount"
  | "metadata"
> & {
  _id?: unknown;
};

type TPreviewResult = {
  branchId: string;
  branchName: string;
  targetDate: string;
  template: string;
  templateCategory: TSmsTemplateCategory;
  deliveryMode: TSmsDeliveryMode;
  dueDuration?: TSmsDueDuration;
  dueDurationCounts?: TSmsDueDurationCounts;
  balance: TSmsBalanceSnapshot;
  summary: TSmsPreviewSummary;
  recipients: TSmsRecipientPreview[];
};

type TResolvedPreview = {
  branchId: string;
  branchName: string;
  audience: TSmsAudience;
  targetDate: Date;
  template: string;
  templateCategory: TSmsTemplateCategory;
  deliveryMode: TSmsDeliveryMode;
  maskingSender: string | null;
  dueDuration?: TSmsDueDuration;
  dueDurationCounts?: TSmsDueDurationCounts;
  balance: TSmsBalanceSnapshot;
  summary: TSmsPreviewSummary;
  recipients: TSmsRecipientPreview[];
};

let schedulerHandle: NodeJS.Timeout | null = null;

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;
const SINGLE_SMS_CHARACTER_LIMIT = 160;
const UNICODE_SMS_CHARACTER_LIMIT = 70;
const UNICODE_SMS_MULTI_PART_CHARS = 67;
const ENGLISH_SMS_MULTI_PART_CHARS = 153;
const ENGLISH_SMS_TEXT_PATTERN = /^[\x20-\x7E\r\n]*$/;

const countMessageCharacters = (message: string) => Array.from(message).length;

const isEnglishSmsText = (message: string) => ENGLISH_SMS_TEXT_PATTERN.test(message);

const formatDueMonthLabel = (targetDate: Date, overdueMonths: number) => {
  const safeOverdueMonths = Math.max(overdueMonths, 1);
  const endMonth = new Date(targetDate.getFullYear(), targetDate.getMonth(), 1);
  const startMonth = new Date(
    endMonth.getFullYear(),
    endMonth.getMonth() - safeOverdueMonths + 1,
    1,
  );

  if (
    startMonth.getFullYear() === endMonth.getFullYear() &&
    startMonth.getMonth() === endMonth.getMonth()
  ) {
    return formatEnglishMonth(endMonth);
  }

  if (startMonth.getFullYear() === endMonth.getFullYear()) {
    return `${formatEnglishMonth(startMonth)}-${formatEnglishMonth(endMonth)}`;
  }

  return `${formatEnglishMonth(startMonth, true)}-${formatEnglishMonth(endMonth, true)}`;
};

const detectSmsMessageType = (message: string): TSmsMessageType => {
  return isEnglishSmsText(message) ? "text" : "unicode";
};

const estimateSmsUnits = (message: string): number => {
  const isUnicode = !isEnglishSmsText(message);
  const firstPartLimit = isUnicode ? UNICODE_SMS_CHARACTER_LIMIT : SINGLE_SMS_CHARACTER_LIMIT;
  const multiPartChars = isUnicode ? UNICODE_SMS_MULTI_PART_CHARS : ENGLISH_SMS_MULTI_PART_CHARS;

  if (message.length <= firstPartLimit) {
    return 1;
  }

  return Math.ceil(message.length / multiPartChars);
};

const resolveBalanceBucket = (): TSmsBalanceBucket => "masking";

const resolveAvailableBalance = (balance: TSmsBalanceSnapshot) =>
  Math.max(Number(balance.maskingBalance || 0), 0);

const resolveTemplateByCategory = (
  templateCategory: TSmsTemplateCategory,
  templateSource: ReturnType<typeof normalizeBranchSMSSettings>,
) => {
  switch (templateCategory) {
    case "occasion":
      return templateSource.occasionTemplateBangla || templateSource.occasionTemplate;
    case "promotion":
      return templateSource.promotionTemplateBangla || templateSource.promotionTemplate;
    case "custom":
      return "";
    case "due":
    default:
      return templateSource.templateBangla || templateSource.template;
  }
};

const matchesDueDuration = (
  overdueMonths: number,
  dueDuration: TSmsDueDuration,
) => {
  if (overdueMonths <= 0) {
    return false;
  }

  switch (dueDuration) {
    case "thisMonth":
      return overdueMonths === 1;
    case "last2Months":
      return overdueMonths <= 2;
    case "last3Months":
      return overdueMonths <= 3;
    case "allDue":
    default:
      return true;
  }
};

const buildDueDurationCounts = (
  recipients: TSmsRecipientPreview[],
): TSmsDueDurationCounts => ({
  thisMonth: recipients.filter((recipient) => matchesDueDuration(recipient.overdueMonths, "thisMonth")).length,
  last2Months: recipients.filter((recipient) => matchesDueDuration(recipient.overdueMonths, "last2Months")).length,
  last3Months: recipients.filter((recipient) => matchesDueDuration(recipient.overdueMonths, "last3Months")).length,
  allDue: recipients.filter((recipient) => matchesDueDuration(recipient.overdueMonths, "allDue")).length,
});

const renderSmsTemplate = (
  template: string,
  context: Record<string, string>,
) =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => context[key] ?? "");

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

  if (actor?.system) {
    return branch;
  }

  if (actor?.userId) {
    const business = await BusinessProfileRepository.findOne({
      _id: new Types.ObjectId(businessId),
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

  if (actor?.staff) {
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

const resolveMembersForAudience = async (
  branchId: string,
  audience: TSmsAudience,
  memberIds?: string[],
) => {
  const filter: Record<string, unknown> = {
    branchId: new Types.ObjectId(branchId),
  };

  if (audience === "due") {
    filter.isActive = true;
  } else {
    const validIds = (memberIds || []).filter((memberId) => Types.ObjectId.isValid(memberId));
    filter._id = {
      $in: validIds.map((memberId) => new Types.ObjectId(memberId)),
    };
  }

  return MemberRepository.findMany(filter, {
    select:
      "fullName memberId contact currentDueAmount nextPaymentDate isActive isCustomMonthlyFee customMonthlyFeeAmount metadata",
  }).lean() as Promise<TResolvedRecipientMember[]>;
};

const toRecipientPreview = (
  member: TResolvedRecipientMember,
  branch: TBranch,
  targetDate: Date,
  template: string,
  audience: TSmsAudience,
  _templateCategory: TSmsTemplateCategory,
): TSmsRecipientPreview | null => {
  const billing = reconcileMemberBillingState(member, branch, targetDate);

  if (audience === "due" && (!billing.monthlyFeeAmount || billing.currentDueAmount <= 0)) {
    return null;
  }

  const recipientPhone = normalizeBangladeshPhone(member.contact);
  const dueMonthAnchor =
    audience === "due"
      ? targetDate
      : billing.updatedNextPaymentDate ||
        (member.nextPaymentDate ? new Date(member.nextPaymentDate) : targetDate);
  const dueMonthLabel =
    audience === "due"
      ? formatDueMonthLabel(targetDate, billing.overdueMonths)
      : formatDueMonthLabel(dueMonthAnchor, 1);
  const monthlyDueAmount = normalizeMoney(billing.monthlyFeeAmount ?? 0);
  const totalDueAmount = normalizeMoney(billing.currentDueAmount ?? 0);

  const renderedMessage = renderSmsTemplate(template, {
    memberName: member.fullName,
    dueMonth: dueMonthLabel,
    monthlyDue: formatEnglishAmount(monthlyDueAmount),
    totalDue: formatEnglishAmount(totalDueAmount),
    branchName: branch.branchName,
  });
  const messageType = detectSmsMessageType(renderedMessage);
  const status = !recipientPhone ? "blocked" : "ready";
  const reason = !recipientPhone
    ? "Member does not have a valid Bangladesh mobile number"
    : undefined;

  return {
    memberId: String(member._id || ""),
    memberName: member.fullName,
    memberIdentifier: member.memberId,
    recipientPhone: recipientPhone || null,
    dueMonthLabel,
    overdueMonths: billing.overdueMonths,
    monthlyDueAmount,
    totalDueAmount,
    renderedMessage,
    messageType,
    units: status === "ready" ? estimateSmsUnits(renderedMessage) : 0,
    status,
    reason,
  };
};

const summarizePreview = (
  recipients: TSmsRecipientPreview[],
  balance: TSmsBalanceSnapshot,
  deliveryMode: TSmsDeliveryMode,
): TSmsPreviewSummary => {
  const readyRecipients = recipients.filter((recipient) => recipient.status === "ready");
  const requiredUnits = readyRecipients.reduce(
    (total, recipient) => total + recipient.units,
    0,
  );
  const balanceBucket = resolveBalanceBucket();
  const availableBalance = resolveAvailableBalance(balance);
  const remainingBalance = Math.max(availableBalance - requiredUnits, 0);
  const insufficientBalance = requiredUnits > availableBalance;
  const textRecipients = readyRecipients.filter((r) => r.messageType === "text").length;
  const unicodeRecipients = readyRecipients.filter((r) => r.messageType === "unicode").length;
  const messageType: TSmsMessageTypeSummary =
    textRecipients > 0 && unicodeRecipients > 0
      ? "mixed"
      : unicodeRecipients > 0
        ? "unicode"
        : "text";
  const messagesOverSingleSmsLimit = readyRecipients.filter((recipient) => {
    const limit = recipient.messageType === "unicode" ? UNICODE_SMS_CHARACTER_LIMIT : SINGLE_SMS_CHARACTER_LIMIT;
    return countMessageCharacters(recipient.renderedMessage) > limit;
  }).length;

  return {
    totalRecipients: recipients.length,
    readyRecipients: readyRecipients.length,
    blockedRecipients: recipients.length - readyRecipients.length,
    requiredUnits,
    availableBalance,
    remainingBalance,
    canSend: readyRecipients.length > 0 && !insufficientBalance,
    insufficientBalance,
    deliveryMode,
    balanceBucket,
    messageType,
    textRecipients,
    unicodeRecipients,
    messagesOverSingleSmsLimit,
    singleSmsCharacterLimit: SINGLE_SMS_CHARACTER_LIMIT,
  };
};

const buildPreview = async (
  businessId: string,
  branchId: string,
  actor: TSmsActor,
  payload: TSmsPreviewPayload,
): Promise<TResolvedPreview> => {
  const branch = await resolveBranchAccess(businessId, branchId, actor);
  const smsSettings = normalizeBranchSMSSettings(branch.smsSettings);
  const audience = payload.audience || "selected";
  const targetDate = payload.targetDate ? new Date(payload.targetDate) : new Date();
  const templateCategory = audience === "due" ? "due" : payload.templateCategory || "custom";
  const deliveryMode: TSmsDeliveryMode = "masking";
  const dueDuration = audience === "due" ? payload.dueDuration || "allDue" : undefined;

  if (!smsSettings.maskingSender) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "Masking sender is not configured for this branch",
    );
  }

  const template =
    payload.template?.trim() ||
    resolveTemplateByCategory(templateCategory, smsSettings);

  if (!template) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "A message template is required before previewing SMS",
    );
  }



  const members = await resolveMembersForAudience(branchId, audience, payload.memberIds);
  const resolvedRecipients = members
    .map((member) =>
      toRecipientPreview(member, branch, targetDate, template, audience, templateCategory),
    )
    .filter((recipient): recipient is TSmsRecipientPreview => Boolean(recipient));
  const recipients =
    audience === "due" && dueDuration
      ? resolvedRecipients.filter((recipient) =>
          matchesDueDuration(recipient.overdueMonths, dueDuration),
        )
      : resolvedRecipients;
  const dueDurationCounts =
    audience === "due"
      ? buildDueDurationCounts(resolvedRecipients)
      : undefined;
  const balance = await SmsProvider.getBalance();
  const summary = summarizePreview(recipients, balance, deliveryMode);

  return {
    branchId,
    branchName: branch.branchName,
    audience,
    targetDate,
    template,
    templateCategory,
    deliveryMode,
    maskingSender: smsSettings.maskingSender ?? null,
    dueDuration,
    dueDurationCounts,
    recipients,
    balance,
    summary,
  };
};

const buildHistoryRows = (
  requestId: string,
  branchId: string,
  preview: Awaited<ReturnType<typeof buildPreview>>,
  sendMode: TSmsSendMode,
  actor: TSmsActor | undefined,
  providerReference: string | undefined,
  forceStatus?: "blocked" | "simulated" | "sent" | "failed",
  forceReason?: string,
  recipientStatuses?: Record<string, { status: "sent" | "failed"; reason?: string }>,
): TSmsHistory[] => {
  return preview.recipients.map((recipient) => {
    const isBlockedRecipient = recipient.status === "blocked";
    const providerResult = recipient.recipientPhone && recipientStatuses
      ? recipientStatuses[recipient.recipientPhone]
      : undefined;
    const status =
      forceStatus ||
      (isBlockedRecipient
        ? "blocked"
        : config.sms.dry_run !== false
          ? "simulated"
          : providerResult?.status || "sent");
    const reason = forceReason || providerResult?.reason || recipient.reason;

    return {
      requestId,
      branchId: new Types.ObjectId(branchId),
      memberId: recipient.memberId ? new Types.ObjectId(recipient.memberId) : null,
      memberName: recipient.memberName,
      recipientPhone: recipient.recipientPhone,
      template: preview.template,
      templateCategory: preview.templateCategory,
      renderedMessage: recipient.renderedMessage,
      audience: preview.audience,
      sendMode,
      deliveryMode: preview.deliveryMode,
      messageType: recipient.messageType,
      balanceBucket: preview.summary.balanceBucket,
      status,
      reason,
      units: recipient.units,
      dueMonthLabel: recipient.dueMonthLabel,
      overdueMonths: recipient.overdueMonths,
      monthlyDueAmount: recipient.monthlyDueAmount,
      totalDueAmount: recipient.totalDueAmount,
      requestedByUserId: actor?.userId ?? null,
      requestedByStaffId: actor?.staff?._id ?? null,
      targetDate: preview.targetDate,
      provider: "fastsmsbd",
      availableBalance: preview.summary.availableBalance,
      remainingBalance: preview.summary.insufficientBalance
        ? preview.summary.availableBalance
        : preview.summary.remainingBalance,
      providerReference,
    };
  });
};

const listDueMembers = async (
  businessId: string,
  branchId: string,
  actor: TSmsActor,
  query: {
    targetDate?: Date;
    dueDuration?: TSmsDueDuration;
    page?: string;
    limit?: string;
    searchTerm?: string;
  },
) => {
  const preview = await buildPreview(businessId, branchId, actor, {
    audience: "due",
    targetDate: query.targetDate,
    dueDuration: query.dueDuration,
  });

  const searchTerm = query.searchTerm?.trim().toLowerCase();
  const filteredRecipients = searchTerm
    ? preview.recipients.filter((recipient) =>
        [recipient.memberName, recipient.memberIdentifier, recipient.recipientPhone]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(searchTerm)),
      )
    : preview.recipients;

  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.max(Number(query.limit) || 25, 1);
  const skip = (page - 1) * limit;

  return {
    branchId: preview.branchId,
    branchName: preview.branchName,
    targetDate: preview.targetDate.toISOString(),
    template: preview.template,
    templateCategory: preview.templateCategory,
    deliveryMode: preview.deliveryMode,
    dueDuration: preview.dueDuration,
    dueDurationCounts: preview.dueDurationCounts,
    balance: preview.balance,
    summary: summarizePreview(filteredRecipients, preview.balance, preview.deliveryMode),
    meta: {
      page,
      limit,
      total: filteredRecipients.length,
    },
    recipients: filteredRecipients.slice(skip, skip + limit),
  };
};

const previewSms = async (
  businessId: string,
  branchId: string,
  actor: TSmsActor,
  payload: TSmsPreviewPayload,
): Promise<TPreviewResult> => {
  const preview = await buildPreview(businessId, branchId, actor, payload);

  return {
    branchId: preview.branchId,
    branchName: preview.branchName,
    targetDate: preview.targetDate.toISOString(),
    template: preview.template,
    templateCategory: preview.templateCategory,
    deliveryMode: preview.deliveryMode,
    dueDuration: preview.dueDuration,
    dueDurationCounts: preview.dueDurationCounts,
    balance: preview.balance,
    summary: preview.summary,
    recipients: preview.recipients,
  };
};

const sendSms = async (
  businessId: string,
  branchId: string,
  actor: TSmsActor,
  payload: TSmsPreviewPayload,
  sendMode: TSmsSendMode = "manual",
) => {
  const preview = await buildPreview(businessId, branchId, actor, payload);
  const requestId = randomUUID();

  if (preview.summary.readyRecipients === 0) {
    const blockedRows = buildHistoryRows(
      requestId,
      branchId,
      preview,
      sendMode,
      actor,
      undefined,
      "blocked",
      "No eligible recipients with valid Bangladesh mobile numbers",
    );
    if (blockedRows.length > 0) {
      await SmsRepository.createMany(blockedRows);
    }

    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "No eligible recipients with valid Bangladesh mobile numbers",
    );
  }

  if (preview.summary.insufficientBalance) {
    const blockedRows = buildHistoryRows(
      requestId,
      branchId,
      preview,
      sendMode,
      actor,
      undefined,
      "blocked",
      "Insufficient masking SMS balance for the full batch",
    );
    await SmsRepository.createMany(blockedRows);

    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "Insufficient masking SMS balance for the full batch",
    );
  }

  const readyRecipients = preview.recipients.filter(
    (recipient) => recipient.status === "ready" && recipient.recipientPhone,
  );

  const providerResponse =
    readyRecipients.length === 1
      ? await SmsProvider.sendBulk(
          readyRecipients.map((recipient) => ({
            mobileNo: recipient.recipientPhone as string,
            smsText: recipient.renderedMessage,
            isUnicode: recipient.messageType === "unicode",
          })),
          requestId,
        )
      : await SmsProvider.sendDynamic(
          readyRecipients.map((recipient) => ({
            mobileNo: recipient.recipientPhone as string,
            smsText: recipient.renderedMessage,
            isUnicode: recipient.messageType === "unicode",
          })),
          requestId,
        );

  const historyRows = buildHistoryRows(
    requestId,
    branchId,
    preview,
    sendMode,
    actor,
    providerResponse.providerReference,
    undefined,
    undefined,
    providerResponse.recipientStatuses,
  );
  await SmsRepository.createMany(historyRows);

  return {
    requestId,
    branchId: preview.branchId,
    branchName: preview.branchName,
    targetDate: preview.targetDate.toISOString(),
    templateCategory: preview.templateCategory,
    deliveryMode: preview.deliveryMode,
    dueDuration: preview.dueDuration,
    dueDurationCounts: preview.dueDurationCounts,
    balance: preview.balance,
    summary: preview.summary,
    status: config.sms.dry_run !== false ? "simulated" : "sent",
    message: providerResponse.responseMessage,
    recipients: preview.recipients,
  };
};

const listHistory = async (
  businessId: string,
  branchId: string,
  actor: TSmsActor,
  query: {
    page?: string;
    limit?: string;
    status?: string;
    sendMode?: string;
    searchTerm?: string;
  },
) => {
  await resolveBranchAccess(businessId, branchId, actor);

  const filter: Record<string, unknown> = {
    branchId: new Types.ObjectId(branchId),
  };

  if (query.status) {
    filter.status = query.status;
  }

  if (query.sendMode) {
    filter.sendMode = query.sendMode;
  }

  if (query.searchTerm?.trim()) {
    const searchRegex = new RegExp(query.searchTerm.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [
      { memberName: searchRegex },
      { recipientPhone: searchRegex },
      { renderedMessage: searchRegex },
      { requestId: searchRegex },
    ];
  }

  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.max(Number(query.limit) || 20, 1);
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    SmsRepository.findMany(filter, {
      sort: { createdAt: -1 },
      skip,
      limit,
    }).lean(),
    SmsRepository.count(filter),
  ]);

  return {
    meta: {
      page,
      limit,
      total,
    },
    data: items,
  };
};

const listMemberHistory = async (
  businessId: string,
  branchId: string,
  memberId: string,
  actor: TSmsActor,
  query: {
    page?: string;
    limit?: string;
    status?: string;
    sendMode?: string;
    searchTerm?: string;
  },
) => {
  await resolveBranchAccess(businessId, branchId, actor);

  const filter: Record<string, unknown> = {
    branchId: new Types.ObjectId(branchId),
    memberId: new Types.ObjectId(memberId),
  };

  if (query.status) {
    filter.status = query.status;
  }

  if (query.sendMode) {
    filter.sendMode = query.sendMode;
  }

  if (query.searchTerm?.trim()) {
    const searchRegex = new RegExp(query.searchTerm.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [
      { memberName: searchRegex },
      { recipientPhone: searchRegex },
      { renderedMessage: searchRegex },
      { requestId: searchRegex },
    ];
  }

  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.max(Number(query.limit) || 20, 1);
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    SmsRepository.findMany(filter, {
      sort: { createdAt: -1 },
      skip,
      limit,
    }).lean(),
    SmsRepository.count(filter),
  ]);

  return {
    meta: {
      page,
      limit,
      total,
    },
    data: items,
  };
};

const getBalance = async (
  businessId: string,
  branchId: string,
  actor: TSmsActor,
) => {
  await resolveBranchAccess(businessId, branchId, actor);
  return SmsProvider.getBalance();
};

const runAutoRemindersForBranch = async (branchId: string) => {
  const branch = await BranchRepository.findById(branchId);

  if (!branch || !branch.businessId) {
    return;
  }

  const smsSettings = normalizeBranchSMSSettings(branch.smsSettings);
  const today = getDhakaDateString();

  if (!smsSettings.autoSendEnabled) {
    return;
  }

  if (smsSettings.lastAutoReminderRunDate === today) {
    return;
  }

  if (smsSettings.reminderDayOfMonth !== getDhakaDayOfMonth()) {
    return;
  }

  try {
    const autoTemplate = resolveTemplateByCategory("due", smsSettings);
    const result = await sendSms(
      String(branch.businessId),
      String(branch._id),
      { system: true },
      {
        audience: "due",
        targetDate: new Date(),
        template: autoTemplate,
      },
      "auto",
    );

    await BranchRepository.updateById(String(branch._id), {
      "smsSettings.lastAutoReminderRunDate": today,
    });

    logger.info("Auto SMS reminder sweep completed", {
      branchId: String(branch._id),
      requestId: result.requestId,
      recipients: result.summary.readyRecipients,
    });
  } catch (error) {
    if (error instanceof AppError && error.statusCode === StatusCodes.BAD_REQUEST) {
      await BranchRepository.updateById(String(branch._id), {
        "smsSettings.lastAutoReminderRunDate": today,
      });
      logger.warn("Auto SMS reminder skipped", {
        branchId: String(branch._id),
        reason: error.message,
      });
      return;
    }

    logger.error("Auto SMS reminder failed", {
      branchId: String(branch._id),
      reason: error instanceof Error ? error.message : String(error),
    });
  }
};

const SMS_LOCK_DURATION_MS = 10 * 60 * 1000;
const SMS_LOCK_NAME = "sms-automation";

const runAutomationSweep = async () => {
  const locked = await SchedulerLockService.tryAcquireLock(
    SMS_LOCK_NAME,
    SMS_LOCK_DURATION_MS,
  );

  if (!locked) {
    return;
  }

  const branches = await BranchRepository.findMany(
    {
      isActive: true,
      "smsSettings.autoSendEnabled": true,
    },
    {
      select: "businessId smsSettings branchName monthlyFeeAmount",
    },
  ).lean();

  for (const branch of branches) {
    await runAutoRemindersForBranch(String(branch._id));
  }
};

const startAutomationScheduler = () => {
  if (schedulerHandle) {
    return;
  }

  schedulerHandle = setInterval(() => {
    void runAutomationSweep();
  }, DEFAULT_INTERVAL_MS);

  void runAutomationSweep();
  logger.info("SMS automation scheduler started", {
    intervalMs: DEFAULT_INTERVAL_MS,
  });
};

export const SmsService = {
  getBalance,
  listDueMembers,
  previewSms,
  sendSms,
  listHistory,
  listMemberHistory,
  runAutoRemindersForBranch,
  startAutomationScheduler,
};
