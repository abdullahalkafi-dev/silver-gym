import {
  DEVICE_ADMIN_ROLE_MIN,
  TUserRecord,
} from "./access.userRecord";
import { isStaffDeviceUserId, normalizeMemberId } from "./access.policy";

export type TMemberDecision = {
  memberRef: string;
  allowed: boolean;
  reason: string;
};

export type TPlannedChange = {
  userId: string;
  uid: number;
  memberRef: string;
  to: "blocked" | "allowed";
  fromGroup: number;
  toGroup: number;
  reason: string;
};

export type TSkippedUser = {
  userId: string;
  why: "staff" | "device_admin" | "unlinked" | "ambiguous";
};

export type TSyncPlan = {
  changes: TPlannedChange[];
  skipped: TSkippedUser[];
  counts: {
    deviceUsers: number;
    linked: number;
    alreadyCorrect: number;
    toBlock: number;
    toAllow: number;
  };
};

export type TPlanInput = {
  users: TUserRecord[];
  /** Keyed by normalized member id. "ambiguous" = two members share the id. */
  decisions: Map<string, TMemberDecision | "ambiguous">;
  blockGroup: number;
  allowGroup: number;
};

/**
 * Works out which device users must move between the normal group and the
 * "blocked" group. Only users linked to exactly one member are ever touched.
 * Staff (id >= 100000), device admins (role != 0) and unknown ids are skipped.
 */
export const planDeviceAccessSync = (input: TPlanInput): TSyncPlan => {
  const changes: TPlannedChange[] = [];
  const skipped: TSkippedUser[] = [];
  let linked = 0;
  let alreadyCorrect = 0;

  for (const user of input.users) {
    const key = normalizeMemberId(user.userId);

    if (isStaffDeviceUserId(key)) {
      skipped.push({ userId: user.userId, why: "staff" });
      continue;
    }

    if (user.role >= DEVICE_ADMIN_ROLE_MIN) {
      skipped.push({ userId: user.userId, why: "device_admin" });
      continue;
    }

    const decision = input.decisions.get(key);
    if (decision === "ambiguous") {
      skipped.push({ userId: user.userId, why: "ambiguous" });
      continue;
    }

    if (!decision) {
      skipped.push({ userId: user.userId, why: "unlinked" });
      continue;
    }

    linked += 1;
    const isBlocked = user.group === input.blockGroup;

    if (decision.allowed && isBlocked) {
      changes.push({
        userId: user.userId,
        uid: user.uid,
        memberRef: decision.memberRef,
        to: "allowed",
        fromGroup: user.group,
        toGroup: input.allowGroup,
        reason: decision.reason,
      });
    } else if (!decision.allowed && !isBlocked) {
      changes.push({
        userId: user.userId,
        uid: user.uid,
        memberRef: decision.memberRef,
        to: "blocked",
        fromGroup: user.group,
        toGroup: input.blockGroup,
        reason: decision.reason,
      });
    } else {
      alreadyCorrect += 1;
    }
  }

  return {
    changes,
    skipped,
    counts: {
      deviceUsers: input.users.length,
      linked,
      alreadyCorrect,
      toBlock: changes.filter((c) => c.to === "blocked").length,
      toAllow: changes.filter((c) => c.to === "allowed").length,
    },
  };
};

export const MAX_BLOCK_RATIO = 0.25;
export const MIN_BLOCK_ALLOWANCE = 10;

/**
 * Safety stop: a bug or bad data must never lock most of the gym out in one
 * run. Allowing people (unblocking) is never limited.
 */
export const assessBlockSafety = (plan: TSyncPlan) => {
  const limit = Math.max(
    MIN_BLOCK_ALLOWANCE,
    Math.ceil(plan.counts.linked * MAX_BLOCK_RATIO),
  );

  return {
    ok: plan.counts.toBlock <= limit,
    limit,
    toBlock: plan.counts.toBlock,
  };
};
