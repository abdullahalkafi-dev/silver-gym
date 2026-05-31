import { StatusCodes } from "http-status-codes";
import AppError from "../../errors/AppError";
import cacheService from "../../redis/cacheService";
import config from "../../config";
import { logger } from "../../logger/logger";
import { TSmsBalanceSnapshot } from "./sms.interface";

type TWintelBalanceResponse = {
  statusCode?: string;
  status?: string;
  nonmasking_sms_balance?: string;
  "nonmasking_sms_balance "?: string;
  masking_sms_balance?: string;
  "masking_sms_balance "?: string;
  message?: string;
};

type TWintelSendResponse = {
  statusCode?: string;
  status?: string;
  message?: string;
};

const isSuccessfulWintelResponse = (response: {
  statusCode?: string;
  status?: string;
}) => {
  const normalizedCode = String(response.statusCode || "").trim();
  const normalizedStatus = String(response.status || "").trim().toLowerCase();

  return normalizedCode === "1000" || normalizedCode === "200" || normalizedStatus === "success";
};

type TWintelManyToManyRequest = {
  mobileNo: string;
  smsText: string;
  ismasking: "true";
  masking: string;
  messagetype: "1";
};

const getRequiredProviderConfig = () => {
  const userId = config.sms.wintel_user_id;
  const password = config.sms.wintel_password;

  if (!userId || !password) {
    throw new AppError(
      StatusCodes.SERVICE_UNAVAILABLE,
      "SMS provider credentials are not configured",
    );
  }

  return {
    userId,
    password,
    apiBaseUrl: String(config.sms.api_base_url || "").replace(/\/$/, ""),
  };
};

const buildToken = () => {
  const { userId, password } = getRequiredProviderConfig();
  return Buffer.from(`${userId}:${password}`).toString("base64");
};

const postToWintel = async <TResponse>(
  path: string,
  payload: Record<string, unknown>,
): Promise<TResponse> => {
  const { apiBaseUrl } = getRequiredProviderConfig();

  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new AppError(
      StatusCodes.BAD_GATEWAY,
      `SMS provider request failed with status ${response.status}`,
    );
  }

  return (await response.json()) as TResponse;
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

const resolveBalanceValue = (
  response: TWintelBalanceResponse,
  matchers: string[],
): number | null => {
  const normalizedEntry = Object.entries(response).find(([key]) =>
    matchers.includes(key.trim().toLowerCase()),
  );

  return normalizedEntry ? parseNumericValue(normalizedEntry[1]) : null;
};

const BALANCE_CACHE_KEY = "sms:wintel:balance";

const getBalance = async (): Promise<TSmsBalanceSnapshot> => {
  const cached = await cacheService.getCache<TSmsBalanceSnapshot>(BALANCE_CACHE_KEY);
  if (cached) {
    return cached;
  }

  const response = await postToWintel<TWintelBalanceResponse>(
    "/smsBalanceEnquiry",
    {
      Token: buildToken(),
    },
  );

  if (!isSuccessfulWintelResponse(response)) {
    throw new AppError(
      StatusCodes.BAD_GATEWAY,
      response.message || "Failed to retrieve SMS balance",
    );
  }

  const balance: TSmsBalanceSnapshot = {
    nonMaskingBalance:
      resolveBalanceValue(response, ["nonmasking_sms_balance"]) ?? 0,
    maskingBalance: resolveBalanceValue(response, ["masking_sms_balance"]),
    fetchedAt: new Date().toISOString(),
    dryRun: config.sms.dry_run !== false,
  };

  const ttl = Number(config.sms.balance_cache_ttl_seconds) || 60;
  await cacheService.setCache(BALANCE_CACHE_KEY, balance, ttl);
  return balance;
};

const sendManyToMany = async (
  requests: TWintelManyToManyRequest[],
  requestId: string,
): Promise<{ providerReference: string; responseMessage: string }> => {
  if (config.sms.dry_run !== false) {
    logger.info("[SMS_DRY_RUN] Wintel many-to-many payload", {
      requestId,
      recipients: requests.length,
      requests,
    });

    return {
      providerReference: `dry-run:${requestId}`,
      responseMessage: "Dry-run only. No SMS was sent to Wintel.",
    };
  }

  const response = await postToWintel<TWintelSendResponse>("/bulkmText", {
    token: buildToken(),
    requests,
  });

  if (!isSuccessfulWintelResponse(response)) {
    throw new AppError(
      StatusCodes.BAD_GATEWAY,
      response.message || "SMS provider rejected the send request",
    );
  }

  return {
    providerReference: `wintel:${requestId}`,
    responseMessage: response.message || "Message has been sent successfully",
  };
};

export const SmsProvider = {
  getBalance,
  sendManyToMany,
};
