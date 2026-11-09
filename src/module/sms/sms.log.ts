import config from "../../config";
import { logger } from "../../logger/logger";

/**
 * One-line SMS logs: `[SMS] event key=value key=value`.
 *
 * - Written to the normal log files AND (in production) to standard output, so
 *   `docker compose logs backend | grep "\[SMS\]"` shows them.
 * - Phone numbers are partly hidden, the API key is never logged, and message
 *   text is never logged (only its length and credit count).
 * - Follow one send from start to end by searching for its requestId.
 */

type TFields = Record<string, unknown>;

export const maskPhone = (phone?: string | null) => {
  if (!phone) return "none";
  const digits = String(phone);
  if (digits.length <= 6) return "***";
  return `${digits.slice(0, 3)}****${digits.slice(-3)}`;
};

/** Hide any long digit run (a phone number) inside free text such as a provider reply. */
export const maskDigitsInText = (text: string) =>
  text.replace(/[0-9]{9,}/g, (digits) => maskPhone(digits));

const formatValue = (value: unknown): string => {
  if (value === null) return "null";
  if (typeof value === "string") return /^[\w.:@/-]+$/.test(value) ? value : JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return "[unprintable]";
  }
};

const build = (event: string, fields: TFields = {}) =>
  `[SMS] ${event}${Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => ` ${key}=${formatValue(value)}`)
    .join("")}`;

const toStdout = config.node_env === "production";

export const smsLog = {
  info(event: string, fields?: TFields) {
    const line = build(event, fields);
    logger.info(line);
    if (toStdout) console.log(line);
  },
  warn(event: string, fields?: TFields) {
    const line = build(event, fields);
    logger.warn(line);
    if (toStdout) console.warn(line);
  },
  error(event: string, fields?: TFields) {
    const line = build(event, fields);
    logger.error(line);
    if (toStdout) console.error(line);
  },
};
