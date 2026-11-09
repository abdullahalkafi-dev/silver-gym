import { StatusCodes } from "http-status-codes";
import AppError from "../../errors/AppError";
import cacheService from "../../redis-client/cacheService";
import config from "../../config";
import { TSmsBalanceSnapshot } from "./sms.interface";
import { maskDigitsInText, maskPhone, smsLog } from "./sms.log";

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
  // Every send passes its own sender (masking or non-masking); this is only the fallback.
  const senderId = config.sms.sender_id || config.sms.masking_sender_id;

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

  if (config.sms.dry_run !== false && !config.sms.api_key) {
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

  const response = await fetch(url, { method: "GET", signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) });

  if (!response.ok) {
    smsLog.warn("provider balance call failed", { httpStatus: response.status });
    throw new AppError(
      StatusCodes.BAD_GATEWAY,
      `SMS balance request failed with status ${response.status}`,
    );
  }

  const data = (await response.json()) as TFastsmsbdBalanceResponse;
  const balanceValue = parseNumericValue(data.response);
  smsLog.info("provider balance fetched", { balance: balanceValue ?? "unreadable" });

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
  /** SMS parts (credits). More than 1 means the provider needs type=long. */
  units: number;
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

const PROVIDER_TIMEOUT_MS = 20000;

const describeFetchError = (error: unknown) => {
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return "The SMS provider did not answer in time. The message may still have been delivered, so check before retrying.";
  }
  return error instanceof Error ? error.message : "Could not reach the SMS provider";
};

const asList = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

/** The provider docs are not public, so accept the status as 0 or "0". */
const isOk = (status: unknown) => Number(status) === 0 && status !== null && status !== "" && status !== undefined;

const snippet = (raw: string) => raw.replace(/\s+/g, " ").slice(0, 80);

/** One GET call for a single recipient. Never throws: failures come back as a result. */
const sendSingle = async (
  message: TSmsOutgoing,
  apiBaseUrl: string,
  apiKey: string,
  senderId: string,
  requestId: string,
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
    // Provider docs: a message longer than one part needs type=long.
    if (message.units > 1) {
      params.type = "long";
    }

    const startedAt = Date.now();
    const response = await fetch(`${apiBaseUrl}/smsapiv3?${buildQueryString(params)}`, {
      method: "GET",
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
    if (!response.ok) {
      smsLog.warn("provider single call failed", {
        requestId,
        to: maskPhone(message.phone),
        httpStatus: response.status,
        ms: Date.now() - startedAt,
      });
      return { status: "failed", reason: `Provider returned HTTP ${response.status}` };
    }

    const raw = await response.text();
    smsLog.info("provider single call answered", {
      requestId,
      to: maskPhone(message.phone),
      sender: senderId,
      unicode: message.unicode,
      credits: message.units,
      long: message.units > 1,
      httpStatus: response.status,
      ms: Date.now() - startedAt,
      reply: maskDigitsInText(snippet(raw)),
    });
    let data: TFastsmsbdSingleResponse = {};
    try {
      data = JSON.parse(raw) as TFastsmsbdSingleResponse;
    } catch {
      /* handled below */
    }
    const item = asList<{ status?: number | string }>(data.response)[0];
    if (!item) {
      return {
        status: "failed",
        reason: `Unexpected reply from provider (not confirmed as sent): ${snippet(raw)}`,
      };
    }
    return isOk(item.status)
      ? { status: "sent" }
      : { status: "failed", reason: describeStatus(Number(item.status)) };
  } catch (error) {
    smsLog.error("provider single call error", {
      requestId,
      to: maskPhone(message.phone),
      error: describeFetchError(error),
    });
    return { status: "failed", reason: describeFetchError(error) };
  }
};

/** Plain-text messages in one POST (each can have its own text). */
const sendMany = async (
  messages: TSmsOutgoing[],
  apiBaseUrl: string,
  apiKey: string,
  senderId: string,
  requestId: string,
): Promise<TSmsRecipientResult[]> => {
  try {
    const startedAt = Date.now();
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
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS * 3),
    });
    if (!response.ok) {
      smsLog.warn("provider batch call failed", {
        requestId,
        recipients: messages.length,
        httpStatus: response.status,
        ms: Date.now() - startedAt,
      });
      return failAll(messages.length, `Provider returned HTTP ${response.status}`);
    }

    const raw = await response.text();
    let data: TFastsmsbdDynamicResponse = {};
    try {
      data = JSON.parse(raw) as TFastsmsbdDynamicResponse;
    } catch {
      /* handled below */
    }
    // Match each reply to the next unmatched message with the same phone number.
    const byPhone = new Map<string, number[]>();
    messages.forEach((msg, index) => {
      const list = byPhone.get(msg.phone) ?? [];
      list.push(index);
      byPhone.set(msg.phone, list);
    });

    const results: TSmsRecipientResult[] = failAll(
      messages.length,
      `Unexpected reply from provider (not confirmed as sent): ${snippet(raw)}`,
    );
    for (const item of asList<{ status?: number | string; msisdn?: string }>(data.response)) {
      const index = item.msisdn ? byPhone.get(item.msisdn)?.shift() : undefined;
      if (index === undefined) continue;
      results[index] = isOk(item.status)
        ? { status: "sent" }
        : { status: "failed", reason: describeStatus(Number(item.status)) };
    }
    const failedReasons = new Map<string, number>();
    results.forEach((r) => {
      if (r.status === "failed") {
        const key = r.reason ?? "unknown";
        failedReasons.set(key, (failedReasons.get(key) ?? 0) + 1);
      }
    });
    smsLog.info("provider batch call answered", {
      requestId,
      sender: senderId,
      recipients: messages.length,
      sent: results.filter((r) => r.status === "sent").length,
      failed: results.filter((r) => r.status === "failed").length,
      failures: failedReasons.size ? Object.fromEntries(failedReasons) : undefined,
      httpStatus: response.status,
      ms: Date.now() - startedAt,
    });
    return results;
  } catch (error) {
    smsLog.error("provider batch call error", {
      requestId,
      recipients: messages.length,
      error: describeFetchError(error),
    });
    return failAll(messages.length, describeFetchError(error));
  }
};

/**
 * Send any mix of messages. One-part plain English messages go in one batch call.
 * Everything else (Unicode, for example a Bangla member name, or anything longer
 * than one part) goes one by one through the single endpoint, because only that
 * endpoint documents the smsformat=8 and type=long flags.
 */
const sendMessages = async (
  messages: TSmsOutgoing[],
  requestId: string,
  senderIdOverride?: string,
): Promise<TSmsSendOutcome> => {
  if (config.sms.dry_run !== false) {
    smsLog.info("dry run: nothing was sent", {
      requestId,
      recipients: messages.length,
      sender: senderIdOverride,
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
  messages.forEach((msg, index) =>
    (msg.unicode || msg.units > 1 ? unicodeIndexes : plainIndexes).push(index),
  );

  if (plainIndexes.length === 1) {
    const index = plainIndexes[0]!;
    results[index] = await sendSingle(messages[index]!, apiBaseUrl, apiKey, senderId, requestId);
  } else if (plainIndexes.length > 1) {
    const plainResults = await sendMany(
      plainIndexes.map((index) => messages[index]!),
      apiBaseUrl,
      apiKey,
      senderId,
      requestId,
    );
    plainIndexes.forEach((index, position) => (results[index] = plainResults[position]!));
  }

  for (const index of unicodeIndexes) {
    results[index] = await sendSingle(messages[index]!, apiBaseUrl, apiKey, senderId, requestId);
  }

  return { providerReference: `fastsmsbd:${requestId}`, dryRun: false, results };
};

export const SmsProvider = {
  getBalance,
  sendMessages,
};
