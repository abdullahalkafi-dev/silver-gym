import { StatusCodes } from "http-status-codes";
import { Types } from "mongoose";

import AppError from "../../errors/AppError";
import { logger } from "../../logger/logger";
import { getDhakaDateString } from "../../utils/dhakaTime";
import { BranchRepository } from "../branch/branch.repository";
import { TBranchAccessControl } from "../branch/branch.interface";
import { BusinessProfileRepository } from "../businessProfile/businessProfile.repository";
import { readMemberBillingLedger } from "../member/member.billingLedger";
import { Member } from "../member/member.model";
import {
  computeAccessForBranch,
  DEFAULT_ACCESS_DEBOUNCE_MINUTES,
  DEFAULT_ACCESS_GRACE_DAYS,
  isStaffDeviceUserId,
  normalizeGraceDays,
  normalizeMemberId,
} from "./access.policy";
import { AccessDevice, AttendanceLog } from "./access.model";
import { parseDeviceWallClock, toVerifyMode } from "./access.logParser";
import { TAttendanceKind, TRawDeviceLog } from "./access.interface";
import { withDevice } from "./device.adapter";
import { findMemberByAdminId } from "./access.memberId";
import {
  releaseEveryoneOnDevices,
  SafetyStopError,
  syncDeviceAccess,
} from "./access.deviceSync";

export type TAccessActor = {
  userId?: Types.ObjectId;
  staff?: { _id: string; branchId?: string; isActive?: boolean };
};

const FULL_PULL_EVERY_MS = 15 * 60 * 1000;
const BULK_CHUNK = 1000;

// ─── Branch access + settings ───────────────────────────────────────────────

const resolveBranch = async (branchId: string, actor: TAccessActor) => {
  if (!Types.ObjectId.isValid(branchId)) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Invalid branch id");
  }

  const branch = await BranchRepository.findOne({
    _id: new Types.ObjectId(branchId),
    isActive: true,
  });

  if (!branch) {
    throw new AppError(StatusCodes.NOT_FOUND, "Branch not found");
  }

  if (actor.userId) {
    const business = await BusinessProfileRepository.findOne({
      _id: branch.businessId,
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

  if (actor.staff) {
    if (actor.staff.isActive === false) {
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

const toSettings = (raw?: Partial<TBranchAccessControl> | null) => ({
  enabled: raw?.enabled === true,
  graceDays: normalizeGraceDays(raw?.graceDays ?? DEFAULT_ACCESS_GRACE_DAYS),
  debounceMinutes: Math.max(
    0,
    Math.min(60, Number(raw?.debounceMinutes ?? DEFAULT_ACCESS_DEBOUNCE_MINUTES)),
  ),
  updatedAt: raw?.updatedAt ?? null,
});

const getSettings = async (branchId: string, actor: TAccessActor) => {
  const branch = await resolveBranch(branchId, actor);
  return toSettings(branch.accessControl);
};

const updateSettings = async (
  branchId: string,
  actor: TAccessActor,
  payload: { enabled?: boolean; graceDays?: number; debounceMinutes?: number },
) => {
  const branch = await resolveBranch(branchId, actor);
  const current = toSettings(branch.accessControl);

  if (payload.enabled === true && current.enabled === false) {
    const health = await getIdHealth(branchId, actor);
    if (health.collisions.length > 0) {
      throw new AppError(
        StatusCodes.CONFLICT,
        `Cannot enable access control: ${health.collisions.length} member ID(s) clash after removing leading zeros (e.g. ${health.collisions[0]?.ids.join(" / ")}). Fix them first.`,
      );
    }
  }

  const next = {
    enabled: payload.enabled ?? current.enabled,
    graceDays:
      payload.graceDays !== undefined
        ? normalizeGraceDays(payload.graceDays)
        : current.graceDays,
    debounceMinutes: payload.debounceMinutes ?? current.debounceMinutes,
    updatedAt: new Date(),
    updatedBy: actor.userId ?? null,
  };

  await BranchRepository.updateById(branchId, { accessControl: next });

  if (current.enabled && !next.enabled) {
    // Nobody may stay locked out once door control is off.
    void releaseEveryoneOnDevices(branchId);
  }

  return toSettings(next);
};

// ─── Member id health (collision guard) ─────────────────────────────────────

const getIdHealth = async (branchId: string, actor: TAccessActor) => {
  await resolveBranch(branchId, actor);

  const members = await Member.find({ branchId: new Types.ObjectId(branchId) })
    .select("memberId fullName")
    .lean();

  const groups = new Map<string, string[]>();
  let withoutId = 0;

  for (const member of members) {
    const key = normalizeMemberId(member.memberId);
    if (!key) {
      withoutId += 1;
      continue;
    }
    groups.set(key, [...(groups.get(key) ?? []), String(member.memberId)]);
  }

  const collisions = [...groups.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([key, ids]) => ({ key, ids }));

  return { totalMembers: members.length, withoutId, collisions };
};

// ─── Devices ────────────────────────────────────────────────────────────────

const listDevices = async (branchId: string, actor: TAccessActor) => {
  await resolveBranch(branchId, actor);
  return AccessDevice.find({ branchId: new Types.ObjectId(branchId) })
    .sort({ createdAt: 1 })
    .lean();
};

const createDevice = async (
  branchId: string,
  actor: TAccessActor,
  payload: { name: string; host: string; port: number; deviceModel?: string },
) => {
  await resolveBranch(branchId, actor);

  try {
    return await AccessDevice.create({
      branchId: new Types.ObjectId(branchId),
      name: payload.name,
      host: payload.host,
      port: payload.port,
      deviceModel: payload.deviceModel,
      isActive: true,
    });
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      throw new AppError(
        StatusCodes.CONFLICT,
        "A device with this host and port already exists",
      );
    }
    throw error;
  }
};

const loadDevice = async (
  branchId: string,
  deviceId: string,
  actor: TAccessActor,
) => {
  await resolveBranch(branchId, actor);

  if (!Types.ObjectId.isValid(deviceId)) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Invalid device id");
  }

  const device = await AccessDevice.findOne({
    _id: new Types.ObjectId(deviceId),
    branchId: new Types.ObjectId(branchId),
  });

  if (!device) {
    throw new AppError(StatusCodes.NOT_FOUND, "Device not found");
  }

  return device;
};

const updateDevice = async (
  branchId: string,
  deviceId: string,
  actor: TAccessActor,
  payload: {
    name?: string;
    host?: string;
    port?: number;
    isActive?: boolean;
    writeEnabled?: boolean;
    blockGroup?: number | null;
    allowGroup?: number;
  },
) => {
  const device = await loadDevice(branchId, deviceId, actor);

  const touchesDoorChanges =
    payload.writeEnabled !== undefined ||
    payload.blockGroup !== undefined ||
    payload.allowGroup !== undefined;

  if (touchesDoorChanges && !actor.userId) {
    throw new AppError(
      StatusCodes.FORBIDDEN,
      "Only the owner can change door settings of a device",
    );
  }

  Object.assign(device, payload);

  if (device.writeEnabled) {
    if (device.blockGroup === null || device.blockGroup === undefined) {
      throw new AppError(
        StatusCodes.BAD_REQUEST,
        "Set the blocked group before enabling door changes",
      );
    }
    if (device.blockGroup === (device.allowGroup ?? 1)) {
      throw new AppError(
        StatusCodes.BAD_REQUEST,
        "The blocked group must be different from the normal group",
      );
    }
  }

  await device.save();
  return device;
};

const testDevice = async (
  branchId: string,
  deviceId: string,
  actor: TAccessActor,
) => {
  const device = await loadDevice(branchId, deviceId, actor);

  try {
    const info = await withDevice(device, (session) => session.getInfo());

    device.lastSeenAt = new Date();
    device.lastError = null;
    if (info.serialNumber) device.serialNumber = info.serialNumber;
    if (info.deviceName) device.deviceModel = info.deviceName;
    await device.save();

    return { ok: true, ...info };
  } catch (error) {
    device.lastError = error instanceof Error ? error.message : String(error);
    await device.save();
    return { ok: false, error: device.lastError };
  }
};

// ─── Pulling scans from the device ──────────────────────────────────────────

type TMemberLookup = Map<string, { _id: Types.ObjectId; memberId: string } | "ambiguous">;

const buildMemberLookup = async (branchId: Types.ObjectId) => {
  const members = await Member.find({ branchId })
    .select("memberId")
    .lean<{ _id: Types.ObjectId; memberId?: string }[]>();

  const lookup: TMemberLookup = new Map();

  for (const member of members) {
    const key = normalizeMemberId(member.memberId);
    if (!key) continue;
    lookup.set(
      key,
      lookup.has(key)
        ? "ambiguous"
        : { _id: member._id, memberId: String(member.memberId) },
    );
  }

  return lookup;
};

const classify = (deviceUserKey: string, lookup: TMemberLookup) => {
  if (isStaffDeviceUserId(deviceUserKey)) {
    return { kind: "staff" as TAttendanceKind, memberRef: null, memberId: null };
  }

  const found = lookup.get(deviceUserKey);
  if (found && found !== "ambiguous") {
    return {
      kind: "member" as TAttendanceKind,
      memberRef: found._id,
      memberId: found.memberId,
    };
  }

  return { kind: "unlinked" as TAttendanceKind, memberRef: null, memberId: null };
};

/** Scans saved before the member existed in the app get linked later. */
const relinkUnlinkedLogs = async (
  branchId: Types.ObjectId,
  lookup: TMemberLookup,
) => {
  const keys: string[] = await AttendanceLog.distinct("deviceUserKey", {
    branchId,
    kind: "unlinked",
  });

  let relinked = 0;

  for (const key of keys) {
    const found = lookup.get(key);
    if (!found || found === "ambiguous") continue;

    const result = await AttendanceLog.updateMany(
      { branchId, kind: "unlinked", deviceUserKey: key },
      { $set: { kind: "member", memberRef: found._id, memberId: found.memberId } },
    );
    relinked += result.modifiedCount;
  }

  return relinked;
};

export type TPullResult = {
  skipped?: boolean;
  fetched: number;
  inserted: number;
  invalid: number;
  relinked: number;
};

/** Saves raw device scans. Safe to run repeatedly: existing scans are left untouched. */
export const ingestRawLogs = async (
  device: { _id: Types.ObjectId; branchId: Types.ObjectId },
  logs: TRawDeviceLog[],
  now: Date = new Date(),
) => {
  const lookup = await buildMemberLookup(device.branchId);
  let invalid = 0;
  const operations: any[] = [];

  for (const log of logs) {
    const parsed = parseDeviceWallClock(log.recordTime);
    if (!parsed || !log.userId) {
      invalid += 1;
      continue;
    }

    const deviceUserKey = normalizeMemberId(log.userId);
    const who = classify(deviceUserKey, lookup);

    operations.push({
      updateOne: {
        filter: {
          deviceId: device._id,
          deviceUserId: log.userId,
          punchTime: parsed.punchTime,
        },
        update: {
          $setOnInsert: {
            branchId: device.branchId,
            deviceId: device._id,
            deviceUserId: log.userId,
            deviceUserKey,
            punchTime: parsed.punchTime,
            attendanceDate: parsed.attendanceDate,
            verifyMode: toVerifyMode(log.type),
            createdAt: now,
            ...who,
          },
        },
        upsert: true,
      },
    });
  }

  let inserted = 0;
  for (let i = 0; i < operations.length; i += BULK_CHUNK) {
    const result = await AttendanceLog.bulkWrite(
      operations.slice(i, i + BULK_CHUNK),
      { ordered: false },
    );
    inserted += result.upsertedCount;
  }

  const relinked = await relinkUnlinkedLogs(device.branchId, lookup);

  return { inserted, invalid, relinked };
};

const pullDeviceLogs = async (
  device: InstanceType<typeof AccessDevice>,
  options: { force?: boolean } = {},
): Promise<TPullResult> => {
  const now = new Date();

  try {
    const pulled = await withDevice(device, async (session) => {
      const count = await session.getLogCount();
      const stale =
        !device.lastPullAt ||
        now.getTime() - device.lastPullAt.getTime() > FULL_PULL_EVERY_MS;

      if (!options.force && !stale && count === device.lastLogCount) {
        return { count, logs: null as null };
      }

      return { count, logs: await session.getLogs() };
    });

    device.lastSeenAt = now;
    device.lastError = null;

    if (!pulled.logs) {
      await device.save();
      return { skipped: true, fetched: 0, inserted: 0, invalid: 0, relinked: 0 };
    }

    const ingested = await ingestRawLogs(device, pulled.logs, now);

    device.lastPullAt = now;
    device.lastLogCount = pulled.count;
    await device.save();

    return { fetched: pulled.logs.length, ...ingested };
  } catch (error) {
    device.lastError = error instanceof Error ? error.message : String(error);
    await device.save().catch(() => undefined);
    throw error;
  }
};

const syncDeviceNow = async (
  branchId: string,
  deviceId: string,
  actor: TAccessActor,
) => {
  const device = await loadDevice(branchId, deviceId, actor);

  try {
    return await pullDeviceLogs(device, { force: true });
  } catch (error) {
    throw new AppError(
      StatusCodes.BAD_GATEWAY,
      `Could not read the device: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

const runPullForAllDevices = async () => {
  const devices = await AccessDevice.find({ isActive: true });
  let inserted = 0;

  for (const device of devices) {
    try {
      const result = await pullDeviceLogs(device);
      inserted += result.inserted;
    } catch (error) {
      logger.warn("Attendance pull failed", {
        deviceId: String(device._id),
        host: device.host,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { devices: devices.length, inserted };
};

// ─── Attendance queries ─────────────────────────────────────────────────────

const monthRange = (month: string) => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new AppError(StatusCodes.BAD_REQUEST, "month must be YYYY-MM");
  }

  const [year = 0, mon = 1] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, mon, 0)).getUTCDate();

  return {
    from: `${month}-01`,
    to: `${month}-${String(daysInMonth).padStart(2, "0")}`,
    daysInMonth,
  };
};

const evaluateMemberAccess = (
  member: {
    isActive?: boolean;
    nextPaymentDate?: Date | null;
    metadata?: unknown;
    accessOverride?: { mode?: "allow" | "block" | null; until?: Date | null } | null;
  },
  settings: ReturnType<typeof toSettings>,
) =>
  computeAccessForBranch({
    isActive: member.isActive,
    nextPaymentDate: member.nextPaymentDate,
    ledgerItems: readMemberBillingLedger({ metadata: member.metadata }).items,
    accessOverride: member.accessOverride,
    enabled: settings.enabled,
    graceDays: settings.graceDays,
  });

const getMemberAttendance = async (
  branchId: string,
  memberId: string,
  month: string,
  actor: TAccessActor,
) => {
  const branch = await resolveBranch(branchId, actor);
  const settings = toSettings(branch.accessControl);
  const { from, to, daysInMonth } = monthRange(month);

  if (!Types.ObjectId.isValid(memberId)) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Invalid member id");
  }

  const member = await Member.findOne({
    _id: new Types.ObjectId(memberId),
    branchId: branch._id,
  }).lean();

  if (!member) {
    throw new AppError(StatusCodes.NOT_FOUND, "Member not found");
  }

  const memberRef = member._id;
  const branchObjectId = branch._id as Types.ObjectId;

  const [logs, gymDays, firstBranchLog, lastVisit] = await Promise.all([
    AttendanceLog.find({ memberRef, attendanceDate: { $gte: from, $lte: to } })
      .sort({ punchTime: 1 })
      .select("attendanceDate punchTime verifyMode")
      .lean(),
    AttendanceLog.distinct("attendanceDate", {
      branchId: branchObjectId,
      attendanceDate: { $gte: from, $lte: to },
    }),
    AttendanceLog.findOne({ branchId: branchObjectId })
      .sort({ attendanceDate: 1 })
      .select("attendanceDate")
      .lean(),
    AttendanceLog.findOne({ memberRef })
      .sort({ punchTime: -1 })
      .select("attendanceDate punchTime")
      .lean(),
  ]);

  const byDate = new Map<
    string,
    { date: string; firstScan: Date; lastScan: Date; scans: number; modes: Set<string> }
  >();

  for (const log of logs) {
    const entry = byDate.get(log.attendanceDate);
    if (entry) {
      entry.lastScan = log.punchTime;
      entry.scans += 1;
      entry.modes.add(log.verifyMode);
    } else {
      byDate.set(log.attendanceDate, {
        date: log.attendanceDate,
        firstScan: log.punchTime,
        lastScan: log.punchTime,
        scans: 1,
        modes: new Set([log.verifyMode]),
      });
    }
  }

  const today = getDhakaDateString();
  const joinedOn = getDhakaDateString(
    (member.membershipStartDate as Date | undefined) ??
      (member.createdAt as Date | undefined) ??
      new Date(0),
  );
  const trackingStart = firstBranchLog?.attendanceDate ?? null;
  const absentFrom = trackingStart
    ? [joinedOn, trackingStart].sort().at(-1)!
    : null;
  const gymDaySet = new Set(gymDays as string[]);

  const absentDates: string[] = [];
  if (absentFrom) {
    for (let day = 1; day <= daysInMonth; day++) {
      const date = `${month}-${String(day).padStart(2, "0")}`;
      if (
        date >= absentFrom &&
        date < today &&
        gymDaySet.has(date) &&
        !byDate.has(date)
      ) {
        absentDates.push(date);
      }
    }
  }

  const presentDays = [...byDate.values()].map((entry) => ({
    date: entry.date,
    firstScan: entry.firstScan,
    lastScan: entry.lastScan,
    scans: entry.scans,
    modes: [...entry.modes],
  }));

  return {
    month,
    memberId: member.memberId ?? null,
    trackingStart,
    presentDays,
    absentDates,
    summary: {
      presentCount: presentDays.length,
      absentCount: absentDates.length,
      lastVisit: lastVisit?.punchTime ?? null,
    },
    access: evaluateMemberAccess(member as any, settings),
    settings,
  };
};

const getDayAttendance = async (
  branchId: string,
  date: string,
  actor: TAccessActor,
) => {
  const branch = await resolveBranch(branchId, actor);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new AppError(StatusCodes.BAD_REQUEST, "date must be YYYY-MM-DD");
  }

  const logs = await AttendanceLog.find({
    branchId: branch._id,
    attendanceDate: date,
  })
    .sort({ punchTime: 1 })
    .lean();

  const members = await Member.find({ branchId: branch._id })
    .select("memberId fullName isActive")
    .lean();
  const memberById = new Map(members.map((m) => [String(m._id), m]));

  const present = new Map<string, any>();
  const staff = new Map<string, any>();
  const unknown = new Map<string, any>();

  const add = (target: Map<string, any>, key: string, base: object, log: any) => {
    const entry = target.get(key);
    if (entry) {
      entry.lastScan = log.punchTime;
      entry.scans += 1;
    } else {
      target.set(key, {
        ...base,
        firstScan: log.punchTime,
        lastScan: log.punchTime,
        scans: 1,
        verifyMode: log.verifyMode,
      });
    }
  };

  for (const log of logs) {
    if (log.kind === "member" && log.memberRef) {
      const member = memberById.get(String(log.memberRef));
      add(
        present,
        String(log.memberRef),
        {
          memberRef: String(log.memberRef),
          memberId: member?.memberId ?? log.memberId,
          fullName: member?.fullName ?? null,
        },
        log,
      );
    } else if (log.kind === "staff") {
      add(staff, log.deviceUserKey, { deviceUserId: log.deviceUserId }, log);
    } else {
      add(unknown, log.deviceUserKey, { deviceUserId: log.deviceUserId }, log);
    }
  }

  const absent = members
    .filter((m) => m.isActive !== false && !present.has(String(m._id)))
    .map((m) => ({
      memberRef: String(m._id),
      memberId: m.memberId ?? null,
      fullName: m.fullName,
    }));

  return {
    date,
    present: [...present.values()],
    staff: [...staff.values()],
    unknown: [...unknown.values()],
    absent,
    counts: {
      present: present.size,
      staff: staff.size,
      unknown: unknown.size,
      absent: absent.length,
    },
  };
};

/** Review of what the door WOULD do for every member (works in log-only mode). */
const getAccessPreview = async (branchId: string, actor: TAccessActor) => {
  const branch = await resolveBranch(branchId, actor);
  const settings = toSettings(branch.accessControl);

  const members = await Member.find({ branchId: branch._id })
    .select(
      "memberId fullName isActive nextPaymentDate metadata accessOverride",
    )
    .lean();

  const rows = members.map((member) => {
    const decision = evaluateMemberAccess(member as any, settings);
    return {
      memberRef: String(member._id),
      memberId: member.memberId ?? null,
      fullName: member.fullName,
      isActive: member.isActive !== false,
      wouldBe: decision.wouldBe,
      reason: decision.reason,
      unpaidSince: decision.unpaidSince ?? null,
      graceUntil: decision.graceUntil ?? null,
    };
  });

  const counts = rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.wouldBe] = (acc[row.wouldBe] ?? 0) + 1;
    return acc;
  }, {});

  return {
    settings,
    counts,
    blocked: rows.filter((row) => row.wouldBe === "blocked"),
    inGrace: rows.filter((row) => row.wouldBe === "grace"),
    total: rows.length,
  };
};

const setMemberOverride = async (
  branchId: string,
  memberId: string,
  actor: TAccessActor,
  payload: { mode: "allow" | "block" | null; until?: string | null; reason?: string },
) => {
  const branch = await resolveBranch(branchId, actor);

  if (!Types.ObjectId.isValid(memberId)) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Invalid member id");
  }

  const update =
    payload.mode === null
      ? { $unset: { accessOverride: 1 } }
      : {
          $set: {
            accessOverride: {
              mode: payload.mode,
              until: payload.until ? new Date(payload.until) : null,
              reason: payload.reason,
              setBy: actor.userId ?? null,
              setAt: new Date(),
            },
          },
        };

  const member = await Member.findOneAndUpdate(
    { _id: new Types.ObjectId(memberId), branchId: branch._id },
    update,
    { returnDocument: "after" },
  ).lean();

  if (!member) {
    throw new AppError(StatusCodes.NOT_FOUND, "Member not found");
  }

  return evaluateMemberAccess(member as any, toSettings(branch.accessControl));
};

const toPlanView = (result: Awaited<ReturnType<typeof syncDeviceAccess>>) => ({
  dryRun: result.dryRun,
  applied: result.applied,
  summary: result.summary,
  counts: result.plan.counts,
  changes: result.plan.changes,
  skipped: result.plan.skipped,
  safety: result.safety,
  blockedFromWriting: result.blockedFromWriting,
});

const runDeviceSync = async (
  branchId: string,
  deviceId: string,
  actor: TAccessActor,
  options: Parameters<typeof syncDeviceAccess>[2],
) => {
  const branch = await resolveBranch(branchId, actor);
  const device = await loadDevice(branchId, deviceId, actor);

  try {
    return toPlanView(await syncDeviceAccess(branch, device, options));
  } catch (error) {
    if (error instanceof SafetyStopError) {
      throw new AppError(StatusCodes.CONFLICT, error.message);
    }
    throw new AppError(
      StatusCodes.BAD_GATEWAY,
      `Door device error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

const requireOwner = (actor: TAccessActor) => {
  if (!actor.userId) {
    throw new AppError(StatusCodes.FORBIDDEN, "Only the owner can do this");
  }
};

const getDeviceAccessPlan = (branchId: string, deviceId: string, actor: TAccessActor) =>
  runDeviceSync(branchId, deviceId, actor, { dryRun: true });

const syncDeviceAccessNow = (
  branchId: string,
  deviceId: string,
  actor: TAccessActor,
  options: { force?: boolean; dryRun?: boolean },
) => {
  requireOwner(actor);
  return runDeviceSync(branchId, deviceId, actor, options);
};

const testUserState = (
  branchId: string,
  deviceId: string,
  actor: TAccessActor,
  payload: { memberRef?: string; memberId?: string; state: "blocked" | "allowed" },
) => {
  requireOwner(actor);

  return (async () => {
    let memberRef = payload.memberRef;

    if (!memberRef && payload.memberId) {
      const member = await findMemberByAdminId(branchId, payload.memberId);
      if (!member) {
        throw new AppError(
          StatusCodes.NOT_FOUND,
          `No single member found with ID "${payload.memberId}" in this branch`,
        );
      }
      memberRef = String(member._id);
    }

    return runDeviceSync(branchId, deviceId, actor, {
      forceState: { memberRef: memberRef!, state: payload.state },
    });
  })();
};

const releaseAllOnDevice = (branchId: string, deviceId: string, actor: TAccessActor) => {
  requireOwner(actor);
  return runDeviceSync(branchId, deviceId, actor, { releaseAll: true });
};

export const AccessService = {
  getDeviceAccessPlan,
  syncDeviceAccessNow,
  testUserState,
  releaseAllOnDevice,
  getSettings,
  updateSettings,
  getIdHealth,
  listDevices,
  createDevice,
  updateDevice,
  testDevice,
  syncDeviceNow,
  runPullForAllDevices,
  pullDeviceLogs,
  ingestRawLogs,
  getMemberAttendance,
  getDayAttendance,
  getAccessPreview,
  setMemberOverride,
};
