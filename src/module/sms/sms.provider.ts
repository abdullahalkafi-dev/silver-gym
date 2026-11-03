import { StatusCodes } from "http-status-codes";
import AppError from "../../errors/AppError";
import cacheService from "../../redis-client/cacheService";
import config from "../../config";
import { logger } from "../../logger/logger";
import { TSmsBalanceSnapshot } from "./sms.interface";

type TFastsmsbdBalanceResponse = {
  response?: string;
};

type TFastsmsbdSingleResponse = {
  response?: Array<{
    status?: number;
    id?: number;
    msisdn?: string;
  }>;
};

type TFastsmsbdDynamicResponse = {
  response?: Array<{
    status?: number;
    cid?: number;
    sid?: number;
    msisdn?: string;
  }>;
};

const FASTSMSBD_STATUS_CODES: Record<number, string> = {
  0: "Success",
  101: "Invalid Message Length",
  102: "Sender Not Valid",
  103: "Authentication Failed",
  104: "Invalid User",
  105: "Invalid MSISDN",
  106: "Invalid API Key",
  107: "User Account Suspended",
  108: "IP Address Not Allowed",
  109: "API Access Not Allowed",
  110: "Do Not Disturb (DND)",
  111: "Spam Word Detected in Message",
  1000: "Insufficient Balance",
  2300: "Destination Route Issue",
  2400: "Destination Route Not Permitted",
  3300: "System Error",
};

const getRequiredConfig = () => {
  const apiKey = config.sms.api_key;
  const senderId = config.sms.sender_id;

  if (!apiKey || !senderId) {
    throw new AppError(
      StatusCodes.SERVICE_UNAVAILABLE,
      "SMS provider credentials are not configured",
    );
  }

  return {
    apiKey,
    senderId,
    apiBaseUrl: String(config.sms.api_base_url || "https://smsapi.fastsmsbd.com").replace(/\/$/, ""),
  };
};

const buildQueryString = (params: Record<string, string>): string => {
  return Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");
};

const parseNumericValue = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
};

const BALANCE_CACHE_KEY = "sms:fastsmsbd:balance";

const getBalance = async (): Promise<TSmsBalanceSnapshot> => {
  const cached = await cacheService.getCache<TSmsBalanceSnapshot>(BALANCE_CACHE_KEY);
  if (cached) {
    return cached;
  }

  if (config.sms.dry_run !== false && (!config.sms.api_key || !config.sms.sender_id)) {
    const mockBalance: TSmsBalanceSnapshot = {
      nonMaskingBalance: 0,
      maskingBalance: 9999,
      fetchedAt: new Date().toISOString(),
      dryRun: true,
    };
    return mockBalance;
  }

  const { apiKey, apiBaseUrl } = getRequiredConfig();

  const url = `${apiBaseUrl}/getbalancev3?apikey=${apiKey}`;

  const response = await fetch(url, { method: "GET" });

  if (!response.ok) {
    throw new AppError(
      StatusCodes.BAD_GATEWAY,
      `SMS balance request failed with status ${response.status}`,
    );
  }

  const data = (await response.json()) as TFastsmsbdBalanceResponse;
  const balanceValue = parseNumericValue(data.response);

  if (balanceValue === null) {
    throw new AppError(
      StatusCodes.BAD_GATEWAY,
      "Failed to parse SMS balance from provider",
    );
  }

  const balance: TSmsBalanceSnapshot = {
    nonMaskingBalance: 0,
    maskingBalance: balanceValue,
    fetchedAt: new Date().toISOString(),
    dryRun: config.sms.dry_run !== false,
  };

  const ttl = Number(config.sms.balance_cache_ttl_seconds) || 60;
  await cacheService.setCache(BALANCE_CACHE_KEY, balance, ttl);
  return balance;
};

export type TSmsOutgoing = {
  phone: string;
  text: string;
  unicode: boolean;
};

export type TSmsRecipientResult = {
  status: "sent" | "failed";
  reason?: string;
};

export type TSmsSendOutcome = {
  providerReference: string;
  dryRun: boolean;
  /** Same order and length as the messages that were passed in. */
  results: TSmsRecipientResult[];
};

const describeStatus = (status?: number) =>
  FASTSMSBD_STATUS_CODES[status ?? -1] || `Provider error ${status ?? "unknown"}`;

const failAll = (count: number, reason: string): TSmsRecipientResult[] =>
  Array.from({ length: count }, () => ({ status: "failed" as const, reason }));

/** One GET call for a single recipient. Never throws: failures come back as a result. */
const sendSingle = async (
  message: TSmsOutgoing,
  apiBaseUrl: string,
  apiKey: string,
  senderId: string,
): Promise<TSmsRecipientResult> => {
  try {
    const params: Record<string, string> = {
      apikey: apiKey,
      sender: senderId,
      msisdn: message.phone,
      smstext: message.text,
    };
    if (message.unicode) {
      params.smsformat = "8";
    }

    const response = await fetch(`${apiBaseUrl}/smsapiv3?${buildQueryString(params)}`, {
      method: "GET",
    });
    if (!response.ok) {
      return { status: "failed", reason: `Provider returned HTTP ${response.status}` };
    }

    const data = (await response.json()) as TFastsmsbdSingleResponse;
    const item = data.response?.[0];
    if (!item) {
      return { status: "failed", reason: "No confirmation from provider" };
    }
    return item.status === 0
      ? { status: "sent" }
      : { status: "failed", reason: describeStatus(item.status) };
  } catch (error) {
    return {
      status: "failed",
      reason: error instanceof Error ? error.message : "Could not reach the SMS provider",
    };
  }
};

/** Plain-text messages in one POST (each can have its own text). */
const sendMany = async (
  messages: TSmsOutgoing[],
  apiBaseUrl: string,
  apiKey: string,
  senderId: string,
): Promise<TSmsRecipientResult[]> => {
  try {
    const response = await fetch(`${apiBaseUrl}/smsapimany`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apikey: apiKey,
        sender: senderId,
        messages: messages.map((msg, index) => ({
          id: index + 1,
          msisdn: msg.phone,
          smstext: msg.text,
        })),
      }),
    });
    if (!response.ok) {
      return failAll(messages.length, `Provider returned HTTP ${response.status}`);
    }

    const data = (await response.json()) as TFastsmsbdDynamicResponse;
    // Match each reply to the next unmatched message with the same phone number.
    const byPhone = new Map<string, number[]>();
    messages.forEach((msg, index) => {
      const list = byPhone.get(msg.phone) ?? [];
      list.push(index);
      byPhone.set(msg.phone, list);
    });

    const results: TSmsRecipientResult[] = failAll(messages.length, "No confirmation from provider");
    for (const item of data.response ?? []) {
      const index = item.msisdn ? byPhone.get(item.msisdn)?.shift() : undefined;
      if (index === undefined) continue;
      results[index] =
        item.status === 0 ? { status: "sent" } : { status: "failed", reason: describeStatus(item.status) };
    }
    return results;
  } catch (error) {
    return failAll(
      messages.length,
      error instanceof Error ? error.message : "Could not reach the SMS provider",
    );
  }
};

/**
 * Send any mix of messages. Plain text goes in one batch call; Unicode messages
 * (for example a Bangla member name) go one by one with the unicode flag, because
 * the batch endpoint has no per-message unicode flag.
 */
const sendMessages = async (
  messages: TSmsOutgoing[],
  requestId: string,
  senderIdOverride?: string,
): Promise<TSmsSendOutcome> => {
  if (config.sms.dry_run !== false) {
    logger.info("[SMS_DRY_RUN] Fastsmsbd payload (nothing was sent)", {
      requestId,
      recipients: messages.length,
      senderId: senderIdOverride,
    });
    return {
      providerReference: `dry-run:${requestId}`,
      dryRun: true,
      results: messages.map(() => ({ status: "sent" as const })),
    };
  }

  const { apiKey, senderId: defaultSenderId, apiBaseUrl } = getRequiredConfig();
  const senderId = senderIdOverride?.trim() || defaultSenderId;
  const results: TSmsRecipientResult[] = new Array(messages.length);

  const plainIndexes: number[] = [];
  const unicodeIndexes: number[] = [];
  messages.forEach((msg, index) => (msg.unicode ? unicodeIndexes : plainIndexes).push(index));

  if (plainIndexes.length === 1) {
    const index = plainIndexes[0]!;
    results[index] = await sendSingle(messages[index]!, apiBaseUrl, apiKey, senderId);
  } else if (plainIndexes.length > 1) {
    const plainResults = await sendMany(
      plainIndexes.map((index) => messages[index]!),
      apiBaseUrl,
      apiKey,
      senderId,
    );
    plainIndexes.forEach((index, position) => (results[index] = plainResults[position]!));
  }

  for (const index of unicodeIndexes) {
    results[index] = await sendSingle(messages[index]!, apiBaseUrl, apiKey, senderId);
  }

  return { providerReference: `fastsmsbd:${requestId}`, dryRun: false, results };
};

export const SmsProvider = {
  getBalance,
  sendMessages,
};
