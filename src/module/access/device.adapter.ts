import { TRawDeviceLog, TRawDeviceUser } from "./access.interface";
import { splitUserBlob, USER_RECORD_SIZE } from "./access.userRecord";

// zkteco-js ships no type declarations.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Zkteco = require("zkteco-js");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { COMMANDS, REQUEST_DATA } = require("zkteco-js/src/helper/command");

const CONNECT_TIMEOUT_MS = 10_000;
const LOCAL_UDP_PORT = 5200;

export type TDeviceConnection = { host: string; port: number };

export type TDeviceInfo = {
  serialNumber: string | null;
  deviceName: string | null;
  firmware: string | null;
  userCount: number;
  logCount: number;
};

/**
 * Adapter for ZKTeco terminals (F18 etc.) over TCP.
 *
 * Reads are free. The ONLY write is `writeUserRecord`, which overwrites one
 * existing user with a full 72-byte record that the caller built from the
 * record it just read (see access.userRecord.ts). There is deliberately no
 * delete-user, clear-data or clear-logs call, and the library's own setUser()
 * is never used because it corrupts card numbers.
 */

// The terminal accepts a single TCP session at a time, so sessions to the same
// device are queued instead of racing each other.
const deviceQueues = new Map<string, Promise<unknown>>();

const runExclusive = <T>(key: string, task: () => Promise<T>): Promise<T> => {
  const previous = deviceQueues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  deviceQueues.set(
    key,
    next.catch(() => undefined),
  );
  return next;
};

export const withDevice = <T>(
  connection: TDeviceConnection,
  work: (device: ZkSession) => Promise<T>,
): Promise<T> =>
  runExclusive(`${connection.host}:${connection.port}`, () =>
    openSession(connection, work),
  );

const openSession = async <T>(
  connection: TDeviceConnection,
  work: (device: ZkSession) => Promise<T>,
): Promise<T> => {
  const raw = new Zkteco(
    connection.host,
    connection.port,
    CONNECT_TIMEOUT_MS,
    LOCAL_UDP_PORT,
  );

  try {
    await raw.createSocket();
    return await work(new ZkSession(raw));
  } catch (error) {
    throw new Error(describeDeviceError(error));
  } finally {
    try {
      await raw.disconnect();
    } catch {
      // ignore: the socket may already be closed
    }
  }
};

const describeDeviceError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  try {
    const text = JSON.stringify(error);
    return text.length > 300 ? `${text.slice(0, 300)}...` : text;
  } catch {
    return String(error);
  }
};

const cleanText = (value: unknown) =>
  typeof value === "string" ? value.replace(/\0/g, "").trim() : null;

export class ZkSession {
  constructor(private readonly raw: any) {}

  async getInfo(): Promise<TDeviceInfo> {
    const [info, serialNumber, deviceName, firmware] = await Promise.all([
      this.raw.getInfo(),
      this.raw.getSerialNumber().catch(() => null),
      this.raw.getDeviceName().catch(() => null),
      this.raw.getFirmware().catch(() => null),
    ]);

    return {
      serialNumber: cleanText(serialNumber),
      deviceName: cleanText(deviceName),
      firmware: cleanText(firmware),
      userCount: Number(info?.userCounts ?? 0),
      logCount: Number(info?.logCounts ?? 0),
    };
  }

  async getLogCount(): Promise<number> {
    return Number(await this.raw.getAttendanceSize());
  }

  /** Untouched 72-byte user records, exactly as stored on the device. */
  async getRawUserRecords(): Promise<Buffer[]> {
    const ztcp = this.raw.ztcp;
    await ztcp.freeData();
    const data = await ztcp.readWithBuffer(REQUEST_DATA.GET_USERS);
    await ztcp.freeData();

    if (!data?.data || !Buffer.isBuffer(data.data)) {
      throw new Error("Device returned no user data");
    }

    return splitUserBlob(data.data);
  }

  /**
   * Runs `work` with the terminal paused, then refreshes it so the change takes
   * effect, and always un-pauses it.
   */
  async withWriteWindow<T>(work: () => Promise<T>): Promise<T> {
    await this.raw.disableDevice();
    try {
      return await work();
    } finally {
      try {
        await this.raw.ztcp.executeCmd(COMMANDS.CMD_REFRESHDATA, "");
      } finally {
        await this.raw.enableDevice();
      }
    }
  }

  /** Overwrites ONE existing user with a full record. Nothing else. */
  async writeUserRecord(record: Buffer): Promise<void> {
    if (record.length !== USER_RECORD_SIZE) {
      throw new Error("Refusing to write a user record of the wrong size");
    }

    await this.raw.ztcp.executeCmd(COMMANDS.CMD_USER_WRQ, record);
  }

  async getUsers(): Promise<TRawDeviceUser[]> {
    const result = await this.raw.getUsers();
    const users: any[] = result?.data ?? result ?? [];

    return users.map((user) => ({
      uid: Number(user.uid),
      userId: String(user.userId ?? "").trim(),
      name: cleanText(user.name) ?? "",
      role: Number(user.role ?? 0),
      hasCard: Number(user.cardno ?? 0) > 0,
    }));
  }

  async getLogs(): Promise<TRawDeviceLog[]> {
    const result = await this.raw.getAttendances();
    const logs: any[] = result?.data ?? result ?? [];

    return logs
      .filter((log) => log && log.user_id !== undefined && log.record_time)
      .map((log) => ({
        userId: String(log.user_id).trim(),
        recordTime: String(log.record_time),
        type: Number(log.type ?? 0),
      }));
  }
}
