import { Types } from "mongoose";

import { logger } from "../../logger/logger";
import { BranchRepository } from "../branch/branch.repository";
import { TBranchAccessControl } from "../branch/branch.interface";
import { readMemberBillingLedger } from "../member/member.billingLedger";
import { Member } from "../member/member.model";
import { AccessDevice } from "./access.model";
import {
  computeAccess,
  DEFAULT_ACCESS_GRACE_DAYS,
  normalizeGraceDays,
  normalizeMemberId,
} from "./access.policy";
import {
  assessBlockSafety,
  planDeviceAccessSync,
  TMemberDecision,
  TSyncPlan,
} from "./access.syncPlan";
import {
  onlyGroupDiffers,
  parseUserRecord,
  TUserRecord,
  withGroup,
} from "./access.userRecord";
import { withDevice } from "./device.adapter";

type TBranchLike = {
  _id: Types.ObjectId | string;
  accessControl?: Partial<TBranchAccessControl> | null;
};
type TDeviceDoc = InstanceType<typeof AccessDevice>;

export type TSyncOptions = {
  dryRun?: boolean;
  /** Skip the "too many blocks at once" stop. Manual use only. */
  force?: boolean;
  /** Only look at this one member (payment / status hooks). */
  onlyMemberRef?: string;
  /** Treat every linked member as allowed (switch-off / panic button). */
  releaseAll?: boolean;
  /** Treat just this member as the given state (physical test). */
  forceState?: { memberRef: string; state: "blocked" | "allowed" };
  /** Tests only: replaces the real device connection. */
  openSession?: typeof withDevice;
};

export type TSyncResult = {
  dryRun: boolean;
  applied: number;
  plan: TSyncPlan;
  blockedFromWriting: string[];
  safety: ReturnType<typeof assessBlockSafety>;
  summary: string;
};

export class SafetyStopError extends Error {}

type DecisionMap = Map<string, TMemberDecision | "ambiguous">;

export const buildDecisionMap = async (
  branch: TBranchLike,
  options: { allowEveryone?: boolean } = {},
): Promise<DecisionMap> => {
  const graceDays = normalizeGraceDays(
    branch.accessControl?.graceDays ?? DEFAULT_ACCESS_GRACE_DAYS,
  );

  const members = await Member.find({ branchId: new Types.ObjectId(String(branch._id)) })
    .select("memberId isActive nextPaymentDate metadata accessOverride")
    .lean();

  const map: DecisionMap = new Map();

  for (const member of members) {
    const key = normalizeMemberId(member.memberId);
    if (!key) continue;

    if (map.has(key)) {
      map.set(key, "ambiguous");
      continue;
    }

    const decision = options.allowEveryone
      ? { allowed: true, reason: "released" }
      : computeAccess({
          isActive: member.isActive,
          nextPaymentDate: member.nextPaymentDate,
          ledgerItems: readMemberBillingLedger({ metadata: member.metadata }).items,
          accessOverride: member.accessOverride,
          enabled: true,
          graceDays,
        });

    map.set(key, {
      memberRef: String(member._id),
      allowed: decision.allowed,
      reason: decision.reason,
    });
  }

  return map;
};

/** Reasons why this device may NOT be written to right now (empty = may write). */
export const getWriteGate = (
  branch: TBranchLike,
  device: TDeviceDoc,
  options: { requireBranchEnabled: boolean },
): string[] => {
  const reasons: string[] = [];

  if (options.requireBranchEnabled && branch.accessControl?.enabled !== true) {
    reasons.push("Door control is switched off for this branch");
  }
  if (!device.isActive) reasons.push("Device is inactive");
  if (device.writeEnabled !== true) {
    reasons.push("Door changes are not enabled for this device");
  }
  if (device.blockGroup === null || device.blockGroup === undefined) {
    reasons.push("Blocked group is not set for this device");
  } else if (device.blockGroup === (device.allowGroup ?? 1)) {
    reasons.push("Blocked group must differ from the normal group");
  }

  return reasons;
};

const describe = (plan: TSyncPlan, applied: number) =>
  `${applied} applied · block ${plan.counts.toBlock} · allow ${plan.counts.toAllow} · ` +
  `already correct ${plan.counts.alreadyCorrect} · skipped ${plan.skipped.length}`;

export const syncDeviceAccess = async (
  branch: TBranchLike,
  device: TDeviceDoc,
  options: TSyncOptions = {},
): Promise<TSyncResult> => {
  const blockGroup = device.blockGroup ?? -1;
  const allowGroup = device.allowGroup ?? 1;

  // Switching off or releasing everyone must work even though door control is off.
  const gate = getWriteGate(branch, device, {
    requireBranchEnabled: !options.releaseAll && !options.forceState,
  });
  const willWrite = !options.dryRun && gate.length === 0;

  let decisions = await buildDecisionMap(branch, {
    allowEveryone: options.releaseAll,
  });

  if (options.forceState) {
    const target = [...decisions.entries()].find(
      ([, value]) => value !== "ambiguous" && value.memberRef === options.forceState!.memberRef,
    );
    if (!target || target[1] === "ambiguous") {
      throw new Error("That member cannot be matched to a device user");
    }
    decisions = new Map(decisions);
    decisions.set(target[0], {
      ...target[1],
      allowed: options.forceState.state === "allowed",
      reason: "manual_test",
    });
  }

  const onlyMember = options.onlyMemberRef ?? options.forceState?.memberRef;

  const open = options.openSession ?? withDevice;

  return open(device, async (session) => {
    const records = (await session.getRawUserRecords()).map(parseUserRecord);

    const fullPlan = planDeviceAccessSync({
      users: records,
      decisions,
      blockGroup,
      allowGroup,
    });

    const plan: TSyncPlan = onlyMember
      ? {
          ...fullPlan,
          changes: fullPlan.changes.filter((c) => c.memberRef === onlyMember),
          counts: {
            ...fullPlan.counts,
            toBlock: fullPlan.changes.filter((c) => c.memberRef === onlyMember && c.to === "blocked").length,
            toAllow: fullPlan.changes.filter((c) => c.memberRef === onlyMember && c.to === "allowed").length,
          },
        }
      : fullPlan;

    const safety = assessBlockSafety(plan);

    if (!willWrite || plan.changes.length === 0) {
      return {
        dryRun: !willWrite,
        applied: 0,
        plan,
        blockedFromWriting: gate,
        safety,
        summary: describe(plan, 0),
      };
    }

    if (!safety.ok && !options.force && !onlyMember && !options.releaseAll) {
      throw new SafetyStopError(
        `Safety stop: this run would block ${safety.toBlock} members (limit ${safety.limit}). Nothing was changed.`,
      );
    }

    const originals = new Map(records.map((r) => [r.userId, r]));
    // Let people in before shutting anyone out.
    const ordered = [...plan.changes].sort((a) => (a.to === "allowed" ? -1 : 1));

    await session.withWriteWindow(async () => {
      for (const change of ordered) {
        const original = originals.get(change.userId)!;
        await session.writeUserRecord(withGroup(original.raw, change.toGroup));
      }
    });

    const afterByUser = new Map<string, TUserRecord>(
      (await session.getRawUserRecords())
        .map(parseUserRecord)
        .map((r) => [r.userId, r] as [string, TUserRecord]),
    );

    const failed: string[] = [];
    for (const change of ordered) {
      const original = originals.get(change.userId)!;
      const after = afterByUser.get(change.userId);
      const good =
        after !== undefined &&
        after.group === change.toGroup &&
        onlyGroupDiffers(original.raw, after.raw);
      if (!good) failed.push(change.userId);
    }

    if (failed.length > 0) {
      // Put every touched record back exactly as it was, then stop all writes.
      await session.withWriteWindow(async () => {
        for (const userId of failed) {
          await session.writeUserRecord(originals.get(userId)!.raw);
        }
      });
      device.writeEnabled = false;
      device.lastError = `Verification failed for user(s) ${failed.join(", ")}. Records were restored and door changes were switched off.`;
      await device.save();
      throw new Error(device.lastError);
    }

    const summary = describe(plan, ordered.length);
    device.lastAccessSyncAt = new Date();
    device.lastAccessSyncSummary = summary;
    device.lastError = null;
    await device.save();

    return {
      dryRun: false,
      applied: ordered.length,
      plan,
      blockedFromWriting: [],
      safety,
      summary,
    };
  });
};

/** After a payment / status change: re-check just this member on every device. */
export const resyncMemberOnDevices = async (branchId: string, memberId: string) => {
  const branch = await BranchRepository.findById(branchId);
  if (!branch || branch.accessControl?.enabled !== true) return;

  const devices = await AccessDevice.find({
    branchId: new Types.ObjectId(branchId),
    isActive: true,
    writeEnabled: true,
  });

  for (const device of devices) {
    try {
      await syncDeviceAccess(branch, device, { onlyMemberRef: memberId });
    } catch (error) {
      logger.warn("Door access resync failed", {
        branchId,
        memberId,
        deviceId: String(device._id),
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
};

/** Used when door control is switched off: nobody may stay locked out. */
export const releaseEveryoneOnDevices = async (branchId: string) => {
  const branch = await BranchRepository.findById(branchId);
  if (!branch) return;

  const devices = await AccessDevice.find({
    branchId: new Types.ObjectId(branchId),
    isActive: true,
    writeEnabled: true,
  });

  for (const device of devices) {
    try {
      await syncDeviceAccess(branch, device, { releaseAll: true });
    } catch (error) {
      logger.error("Could not release blocked members", {
        branchId,
        deviceId: String(device._id),
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
};

/** Periodic safety net (grace expiry at midnight, missed hooks, device reboots). */
export const runAccessSyncSweep = async () => {
  const branches = await BranchRepository.findMany({
    isActive: true,
    "accessControl.enabled": true,
  });

  let applied = 0;

  for (const branch of branches) {
    const devices = await AccessDevice.find({
      branchId: branch._id,
      isActive: true,
      writeEnabled: true,
    });

    for (const device of devices) {
      try {
        const result = await syncDeviceAccess(branch, device);
        applied += result.applied;
      } catch (error) {
        device.lastError = error instanceof Error ? error.message : String(error);
        await device.save().catch(() => undefined);
        logger.warn("Door access sync failed", {
          deviceId: String(device._id),
          reason: device.lastError,
        });
      }
    }
  }

  return { branches: branches.length, applied };
};
