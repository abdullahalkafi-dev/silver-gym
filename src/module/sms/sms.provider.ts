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

export type TFastsmsbdSendRequest = {
  mobileNo: string;
  smsText: string;
  isUnicode: boolean;
};

export type TSmsSendResult = {
  providerReference: string;
  responseMessage: string;
  recipientStatuses?: Record<string, { status: "sent" | "failed"; reason?: string }>;
};

const sendBulk = async (
  requests: TFastsmsbdSendRequest[],
  requestId: string,
  senderIdOverride?: string,
): Promise<TSmsSendResult> => {
  if (config.sms.dry_run !== false) {
    logger.info("[SMS_DRY_RUN] Fastsmsbd bulk payload", {
      requestId,
      recipients: requests.length,
      requests,
      senderId: senderIdOverride,
    });

    return {
      providerReference: `dry-run:${requestId}`,
      responseMessage: "Dry-run only. No SMS was sent to Fastsmsbd.",
    };
  }

  const { apiKey, senderId: defaultSenderId, apiBaseUrl } = getRequiredConfig();
  const senderId = senderIdOverride?.trim() || defaultSenderId;

  const results: Array<{ status: number; msisdn: string; id?: number }> = [];
  const recipientStatuses: Record<string, { status: "sent" | "failed"; reason?: string }> = {};
  const hasUnicode = requests.some((r) => r.isUnicode);

  if (requests.length === 1) {
    const request = requests[0]!;
    const params: Record<string, string> = {
      apikey: apiKey,
      sender: senderId,
      msisdn: request.mobileNo,
      smstext: request.smsText,
    };

    if (request.isUnicode) {
      params.smsformat = "8";
    }

    const url = `${apiBaseUrl}/smsapiv3?${buildQueryString(params)}`;
    const response = await fetch(url, { method: "GET" });

    if (!response.ok) {
      throw new AppError(
        StatusCodes.BAD_GATEWAY,
        `SMS provider request failed with status ${response.status}`,
      );
    }

    const data = (await response.json()) as TFastsmsbdSingleResponse;

    if (data.response) {
      for (const item of data.response) {
        const phone = item.msisdn || request.mobileNo;
        results.push({
          status: item.status ?? 1,
          msisdn: phone,
          id: item.id,
        });

        if (item.status !== 0) {
          const errorMessage = FASTSMSBD_STATUS_CODES[item.status!] || `Unknown error: ${item.status}`;
          recipientStatuses[phone] = { status: "failed", reason: errorMessage };
          throw new AppError(
            StatusCodes.BAD_GATEWAY,
            `SMS send failed for ${phone}: ${errorMessage}`,
          );
        } else {
          recipientStatuses[phone] = { status: "sent" };
        }
      }
    }
  } else {
    const msisdns = requests.map((r) => r.mobileNo).join(",");
    const firstMessage = requests[0]!;

    const params: Record<string, string> = {
      apikey: apiKey,
      sender: senderId,
      msisdn: msisdns,
      smstext: firstMessage.smsText,
    };

    if (hasUnicode) {
      params.smsformat = "8";
    }

    const url = `${apiBaseUrl}/smsapiv3?${buildQueryString(params)}`;
    const response = await fetch(url, { method: "GET" });

    if (!response.ok) {
      throw new AppError(
        StatusCodes.BAD_GATEWAY,
        `SMS provider request failed with status ${response.status}`,
      );
    }

    const data = (await response.json()) as TFastsmsbdSingleResponse;

    if (data.response) {
      for (const item of data.response) {
        const phone = item.msisdn || "";
        results.push({
          status: item.status ?? 1,
          msisdn: phone,
          id: item.id,
        });

        if (item.status !== 0) {
          const errorMessage = FASTSMSBD_STATUS_CODES[item.status!] || `Unknown error: ${item.status}`;
          if (phone) {
            recipientStatuses[phone] = { status: "failed", reason: errorMessage };
          }
          logger.warn("[SMS_PROVIDER] Individual send failed in batch", {
            msisdn: item.msisdn,
            status: item.status,
            errorMessage,
          });
        } else if (phone) {
          recipientStatuses[phone] = { status: "sent" };
        }
      }
    }
  }

  const successCount = results.filter((r) => r.status === 0).length;
  const failCount = results.filter((r) => r.status !== 0).length;

  return {
    providerReference: `fastsmsbd:${requestId}`,
    responseMessage: `Sent ${successCount}/${results.length} messages successfully${failCount > 0 ? ` (${failCount} failed)` : ""}`,
    recipientStatuses,
  };
};

const sendDynamic = async (
  messages: Array<{ mobileNo: string; smsText: string; isUnicode: boolean }>,
  requestId: string,
  senderIdOverride?: string,
): Promise<TSmsSendResult> => {
  if (config.sms.dry_run !== false) {
    logger.info("[SMS_DRY_RUN] Fastsmsbd dynamic payload", {
      requestId,
      recipients: messages.length,
      senderId: senderIdOverride,
    });

    return {
      providerReference: `dry-run:${requestId}`,
      responseMessage: "Dry-run only. No SMS was sent to Fastsmsbd.",
    };
  }

  const { apiKey, senderId: defaultSenderId, apiBaseUrl } = getRequiredConfig();
  const senderId = senderIdOverride?.trim() || defaultSenderId;

  const payload = {
    apikey: apiKey,
    sender: senderId,
    messages: messages.map((msg, index) => ({
      id: index + 1,
      msisdn: msg.mobileNo,
      smstext: msg.smsText,
    })),
  };

  const response = await fetch(`${apiBaseUrl}/smsapimany`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new AppError(
      StatusCodes.BAD_GATEWAY,
      `SMS provider request failed with status ${response.status}`,
    );
  }

  const data = (await response.json()) as TFastsmsbdDynamicResponse;
  const recipientStatuses: Record<string, { status: "sent" | "failed"; reason?: string }> = {};

  if (data.response) {
    for (const item of data.response) {
      const phone = item.msisdn || "";
      if (item.status !== 0) {
        const errorMessage = FASTSMSBD_STATUS_CODES[item.status!] || `Unknown error: ${item.status}`;
        if (phone) {
          recipientStatuses[phone] = { status: "failed", reason: errorMessage };
        }
        logger.warn("[SMS_PROVIDER] Dynamic send individual result", {
          cid: item.cid,
          sid: item.sid,
          msisdn: item.msisdn,
          status: item.status,
          errorMessage,
        });
      } else if (phone) {
        recipientStatuses[phone] = { status: "sent" };
      }
    }
  }

  const successCount = data.response?.filter((r) => r.status === 0).length || 0;
  const totalCount = data.response?.length || messages.length;

  return {
    providerReference: `fastsmsbd:${requestId}`,
    responseMessage: `Sent ${successCount}/${totalCount} messages successfully`,
    recipientStatuses,
  };
};

export const SmsProvider = {
  getBalance,
  sendBulk,
  sendDynamic,
};
