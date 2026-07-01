import { Types } from "mongoose";

import { logger } from "../../logger/logger";
import cacheService from "../../redis-client/cacheService";
import { getDhakaDateString } from "../../utils/dhakaTime";
import {
  normalizeBranchAutoDeactivateAfterUnpaidMonths,
  TBranch,
} from "../branch/branch.interface";
import { BranchRepository } from "../branch/branch.repository";
import { SchedulerLockService } from "../scheduler/schedulerLock.service";
import {
  mergeMemberBillingProfileMetadata,
  reconcileMemberBillingState,
} from "./member.billing";
import {
  mergeMemberBillingLedgerMetadata,
  reconcileMemberBillingLedger,
  sumMemberBillingLedger,
} from "./member.billingLedger";
import { TMember } from "./member.interface";
import { MemberRepository } from "./member.repository";

type TAutoDeactivationBranch = Pick<
  TBranch,
  "branchName" | "monthlyFeeAmount" | "autoDeactivateAfterUnpaidMonths"
> & {
  _id?: unknown;
  lastAutoDeactivationRunDate?: string | null;
};

type TAutoDeactivationMember = Pick<
  TMember,
  | "currentDueAmount"
  | "nextPaymentDate"
  | "isActive"
  | "isCustomMonthlyFee"
  | "customMonthlyFeeAmount"
  | "metadata"
  | "fullName"
  | "memberId"
> & {
  _id?: unknown;
};

type TAutoDeactivationEvaluation = {
  thresholdMonths: number;
  shouldDeactivate: boolean;
  billing: ReturnType<typeof reconcileMemberBillingState>;
};

type TAutoDeactivationUpdate = TAutoDeactivationEvaluation & {
  updatePayload: Record<string, unknown>;
};

let schedulerHandle: NodeJS.Timeout | null = null;

const DEFAULT_INTERVAL_MS = 12 * 60 * 60 * 1000;

export const evaluateMemberAutoDeactivation = (
  member: TAutoDeactivationMember,
  branch: TAutoDeactivationBranch,
  now: Date = new Date(),
): TAutoDeactivationEvaluation => {
  const thresholdMonths = normalizeBranchAutoDeactivateAfterUnpaidMonths(
    branch.autoDeactivateAfterUnpaidMonths,
  );
  const billing = reconcileMemberBillingState(member, branch, now);

  return {
    thresholdMonths,
    shouldDeactivate:
      member.isActive !== false && billing.overdueMonths >= thresholdMonths,
    billing,
  };
};

export const buildAutoDeactivationUpdate = (
  member: TAutoDeactivationMember,
  branch: TAutoDeactivationBranch,
  now: Date = new Date(),
): TAutoDeactivationUpdate | null => {
  const evaluation = evaluateMemberAutoDeactivation(member, branch, now);

  if (!evaluation.shouldDeactivate) {
    return null;
  }

  const dueLedger = reconcileMemberBillingLedger(member, evaluation.billing, now);

  return {
    ...evaluation,
    updatePayload: {
      isActive: false,
      currentDueAmount: sumMemberBillingLedger(dueLedger.items),
      metadata: mergeMemberBillingLedgerMetadata(
        mergeMemberBillingProfileMetadata(member.metadata, {
          accrualStoppedAt: now.toISOString(),
        }),
        dueLedger,
      ),
    },
  };
};

const invalidateAutoDeactivatedMemberCaches = async (
  branchId: string,
  memberId: string,
) => {
  try {
    await Promise.all([
      cacheService.deleteCache(`members:${branchId}:${memberId}`),
      cacheService.invalidateByPattern(`members:${branchId}:list:*`),
      cacheService.deleteCache(`members:${branchId}:billing-reconciled`),
    ]);
  } catch (error) {
    logger.warn("Failed to invalidate auto-deactivation caches (will auto-expire)", {
      branchId,
      memberId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export const runAutoDeactivationForBranch = async (
  branchId: string,
  now: Date = new Date(),
) => {
  const branch = await BranchRepository.findOne({
    _id: new Types.ObjectId(branchId),
    isActive: true,
  }).lean<TAutoDeactivationBranch | null>();

  if (!branch?._id) {
    return 0;
  }

  const overdueCutoff = new Date(now.getFullYear(), now.getMonth(), 1);
  const members = await MemberRepository.findMany(
    {
      branchId: new Types.ObjectId(branchId),
      isActive: true,
      nextPaymentDate: { $lt: overdueCutoff },
    },
    {
      select:
        "fullName memberId currentDueAmount nextPaymentDate isActive isCustomMonthlyFee customMonthlyFeeAmount metadata _id",
    },
  ).lean<TAutoDeactivationMember[]>();

  let deactivatedCount = 0;

  for (const member of members) {
    if (!member._id) {
      continue;
    }

    const autoDeactivationUpdate = buildAutoDeactivationUpdate(member, branch, now);

    if (!autoDeactivationUpdate) {
      continue;
    }

    const updatedMember = await MemberRepository.updateById(
      String(member._id),
      autoDeactivationUpdate.updatePayload,
    );

    if (!updatedMember) {
      logger.warn("Member auto-deactivation update returned no record", {
        branchId,
        memberId: String(member._id),
      });
      continue;
    }

    await invalidateAutoDeactivatedMemberCaches(branchId, String(member._id));

    deactivatedCount += 1;

    logger.info("Member auto-deactivated for overdue unpaid months", {
      branchId,
      branchName: branch.branchName,
      memberId: member.memberId,
      memberRecordId: String(member._id),
      memberName: member.fullName,
      thresholdMonths: autoDeactivationUpdate.thresholdMonths,
      overdueMonths: autoDeactivationUpdate.billing.overdueMonths,
      currentDueAmount: autoDeactivationUpdate.billing.currentDueAmount,
    });
  }

  return deactivatedCount;
};

const LOCK_DURATION_MS = 30 * 60 * 1000;
const LOCK_NAME = "auto-deactivation";

export const runAutoDeactivationSweep = async (now: Date = new Date()) => {
  const locked = await SchedulerLockService.tryAcquireLock(
    LOCK_NAME,
    LOCK_DURATION_MS,
  );

  if (!locked) {
    return;
  }

  try {
    const branches = await BranchRepository.findMany(
      { isActive: true },
      {
        select:
          "branchName monthlyFeeAmount autoDeactivateAfterUnpaidMonths lastAutoDeactivationRunDate _id",
      },
    ).lean<TAutoDeactivationBranch[]>();

    const today = getDhakaDateString(now);
    let totalDeactivated = 0;

    for (const branch of branches) {
      if (!branch._id) {
        continue;
      }

      if (branch.lastAutoDeactivationRunDate === today) {
        continue;
      }

      const deactivatedCount = await runAutoDeactivationForBranch(
        String(branch._id),
        now,
      );

      totalDeactivated += deactivatedCount;

      await BranchRepository.updateById(String(branch._id), {
        lastAutoDeactivationRunDate: today,
      });
    }

    logger.info("Member auto-deactivation sweep completed", {
      branchCount: branches.length,
      totalDeactivated,
    });
  } catch (error) {
    logger.error("Member auto-deactivation sweep failed", {
      reason: error instanceof Error ? error.message : String(error),
    });
  } finally {
    await SchedulerLockService.releaseLock(LOCK_NAME);
  }
};

const startScheduler = () => {
  if (schedulerHandle) {
    return;
  }

  schedulerHandle = setInterval(() => {
    void runAutoDeactivationSweep();
  }, DEFAULT_INTERVAL_MS);

  void runAutoDeactivationSweep();

  logger.info("Member auto-deactivation scheduler started", {
    intervalMs: DEFAULT_INTERVAL_MS,
  });
};

export const MemberAutoDeactivationService = {
  startScheduler,
  runAutoDeactivationForBranch,
  runAutoDeactivationSweep,
};