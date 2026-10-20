import { Types } from "mongoose";

export type TAttendanceKind = "member" | "staff" | "unlinked";
export type TVerifyMode = "fingerprint" | "card" | "other";

export interface TAccessDevice {
  branchId: Types.ObjectId;
  name: string;
  deviceModel?: string;
  serialNumber?: string;
  host: string;
  port: number;
  isActive: boolean;
  lastSeenAt?: Date | null;
  lastPullAt?: Date | null;
  lastLogCount?: number | null;
  lastError?: string | null;
  /** Master switch for writing to the terminal. Off until physically tested. */
  writeEnabled?: boolean;
  /** Device group that cannot open the door (set up on the device first). */
  blockGroup?: number | null;
  /** Group a user is returned to when they are allowed again. */
  allowGroup?: number;
  lastAccessSyncAt?: Date | null;
  lastAccessSyncSummary?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface TAttendanceLog {
  branchId: Types.ObjectId;
  deviceId: Types.ObjectId;
  /** Id exactly as the device reports it ("75"). */
  deviceUserId: string;
  /** Same id without leading zeros, used for matching. */
  deviceUserKey: string;
  kind: TAttendanceKind;
  memberRef?: Types.ObjectId | null;
  /** Admin-given memberId at the time of the scan ("0075"). */
  memberId?: string | null;
  /** True instant of the scan. */
  punchTime: Date;
  /** Dhaka calendar day of the scan, YYYY-MM-DD. */
  attendanceDate: string;
  verifyMode: TVerifyMode;
  createdAt?: Date;
}

export type TRawDeviceLog = {
  userId: string;
  /** Wall-clock text from the device, e.g. "Sat Oct 17 2026 16:31:04 GMT+0000". */
  recordTime: string;
  type: number;
};

export type TRawDeviceUser = {
  uid: number;
  userId: string;
  name: string;
  role: number;
  hasCard: boolean;
};
