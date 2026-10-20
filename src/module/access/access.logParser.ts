import { BD_OFFSET_MS, getDhakaDateString } from "../../utils/dhakaTime";
import { TVerifyMode } from "./access.interface";

const MONTHS: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

/**
 * The ZKTeco device stores Dhaka wall-clock time. The zkteco-js library turns it
 * into a text like "Sat Oct 17 2026 16:31:04 GMT+0000 (...)" and the zone in
 * that text is meaningless (it is the server's zone). So only the digits are
 * read, and they are treated as Asia/Dhaka (UTC+6, no DST).
 */
export const parseDeviceWallClock = (
  recordTime: string,
): { punchTime: Date; attendanceDate: string } | null => {
  const match = /([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/.exec(
    String(recordTime),
  );

  if (!match) {
    return null;
  }

  const month = MONTHS[match[1] ?? ""];
  if (month === undefined) {
    return null;
  }

  const wallClockAsUtc = Date.UTC(
    Number(match[3]),
    month,
    Number(match[2]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  );

  const punchTime = new Date(wallClockAsUtc - BD_OFFSET_MS);

  return { punchTime, attendanceDate: getDhakaDateString(punchTime) };
};

export const toVerifyMode = (type: number): TVerifyMode => {
  if (type === 1) {
    return "fingerprint";
  }

  if (type === 4) {
    return "card";
  }

  return "other";
};
