import { Types } from "mongoose";

import { logger } from "../../logger/logger";
import cacheService from "../../redis-client/cacheService";
import { getDhakaDateString } from "../../utils/dhakaTime";
import {
  TBranch,
} from "../branch/branch.interface";
import { BranchRepository } from "../branch/branch.repository";
import { SchedulerLockService } from "../scheduler/schedulerLock.service";
import { resolveMemberMonthlyFeeAmount } from "./member.billing";
import {
  createMemberBillingLedgerItem,
  mergeMemberBillingLedgerMetadata,
  readMemberBillingLedger,
  sumMemberBillingLedger,
} from "./member.billingLedger";
import { TMember } from "./member.interface";
import { MemberRepository } from "./member.repository";
import { addMonthsPreservingDay, endOfCalendarMonth } from "../payment/payment.balance";

type TDueAccrualBranch = Pick<
  TBranch,
  "branchName" | "monthlyFeeAmount" | "autoDeactivateAfterUnpaidMonths"
> & {
  _id?: unknown;
  lastDueAccrualRunDate?: string | null;
};

type TDueAccrualMember = Pick<
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

let schedulerHandle: NodeJS.Timeout | null = null;

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

export const runDueAccrualForBranch = async (
  branchId: string,
  now: Date = new Date(),
) => {
  const branch = await BranchRepository.findOne({
    _id: new Types.ObjectId(branchId),
    isActive: true,
  }).lean<TDueAccrualBranch | null>();

  if (!branch?._id) {
    return 0;
  }

  const overdueCutoff = endOfCalendarMonth(now);

  const members = await MemberRepository.findMany(
    {
      branchId: new Types.ObjectId(branchId),
      isActive: true,
      nextPaymentDate: { $lte: overdueCutoff },
    },
    {
      select:
        "fullName memberId currentDueAmount nextPaymentDate isActive isCustomMonthlyFee customMonthlyFeeAmount metadata _id",
    },
  ).lean<TDueAccrualMember[]>();

  let accrualCount = 0;

  for (const member of members) {
    if (!member._id) {
      continue;
    }

    const nextPaymentDate = member.nextPaymentDate
      ? new Date(member.nextPaymentDate)
      : null;

    if (!nextPaymentDate || Number.isNaN(nextPaymentDate.getTime())) {
      continue;
    }

    const monthlyFeeAmount = resolveMemberMonthlyFeeAmount(member, branch);

    if (!monthlyFeeAmount || monthlyFeeAmount <= 0) {
      continue;
    }

    // Compute overdue months directly (without using reconcileRecurringBillingBalance)
    let overdueMonths = 0;
    let checkDate = new Date(nextPaymentDate);
    while (checkDate <= overdueCutoff) {
      overdueMonths += 1;
      checkDate = addMonthsPreservingDay(checkDate, 1);
    }

    if (overdueMonths <= 0) {
      continue;
    }

    // Read existing ledger
    const existingLedger = readMemberBillingLedger(member);
    const existingItems = [...existingLedger.items];
    const existingKeys = new Set(existingItems.map((item) => item.key));

    // Create monthly_due items for overdue months that don't already exist
    let dueDate = new Date(nextPaymentDate);
    let newItemsAdded = false;
    for (let index = 0; index < overdueMonths; index += 1) {
      const key = `monthly_due:${dueDate.getFullYear()}-${String(dueDate.getMonth() + 1).padStart(2, "0")}`;
      if (!existingKeys.has(key)) {
        const periodStart = new Date(dueDate);
        const periodEnd = addMonthsPreservingDay(periodStart, 1);
        const label = dueDate.toLocaleDateString("en-GB", {
          month: "short",
          year: "numeric",
        });
        existingItems.push(
          createMemberBillingLedgerItem({
            key,
            type: "monthly_due",
            label,
            amount: monthlyFeeAmount,
            now: dueDate,
            dueDate,
            periodStart,
            periodEnd,
          })
        );
        newItemsAdded = true;
      }
      dueDate = addMonthsPreservingDay(dueDate, 1);
    }

    // Compute currentDueAmount from ledger
    const currentDueAmount = sumMemberBillingLedger(existingItems);

    // Only persist if something changed
    const shouldPersist =
      newItemsAdded || currentDueAmount !== (member.currentDueAmount ?? 0);

    if (!shouldPersist) {
      continue;
    }

    const updatedLedger = {
      version: 1 as const,
      items: existingItems,
      updatedAt: now.toISOString(),
    };

    await MemberRepository.updateById(
      String(member._id),
      {
        currentDueAmount,
        metadata: mergeMemberBillingLedgerMetadata(member.metadata, updatedLedger),
      },
    );

    await Promise.all([
      cacheService.deleteCache(`members:${branchId}:${String(member._id)}`),
      cacheService.invalidateByPattern(`members:${branchId}:list:*`),
    ]);

    accrualCount += 1;

    logger.info("Member due accrual created", {
      branchId,
      branchName: branch.branchName,
      memberId: member.memberId,
      memberRecordId: String(member._id),
      memberName: member.fullName,
      overdueMonths,
      monthlyFeeAmount,
      currentDueAmount,
    });
  }

  return accrualCount;
};

const LOCK_DURATION_MS = 30 * 60 * 1000;
const LOCK_NAME = "due-accrual";

export const runDueAccrualSweep = async (now: Date = new Date()) => {
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
          "branchName monthlyFeeAmount autoDeactivateAfterUnpaidMonths lastDueAccrualRunDate _id",
      },
    ).lean<TDueAccrualBranch[]>();

    const today = getDhakaDateString(now);
    let totalAccrued = 0;

    for (const branch of branches) {
      if (!branch._id) {
        continue;
      }

      if (branch.lastDueAccrualRunDate === today) {
        continue;
      }

      const accrualCount = await runDueAccrualForBranch(
        String(branch._id),
        now,
      );

      totalAccrued += accrualCount;

      await BranchRepository.updateById(String(branch._id), {
        lastDueAccrualRunDate: today,
      });
    }

    logger.info("Due accrual sweep completed", {
      branchCount: branches.length,
      totalAccrued,
    });
  } catch (error) {
    logger.error("Due accrual sweep failed", {
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
    void runDueAccrualSweep();
  }, DEFAULT_INTERVAL_MS);

  void runDueAccrualSweep();

  logger.info("Due accrual scheduler started", {
    intervalMs: DEFAULT_INTERVAL_MS,
  });
};

export const MemberDueAccrualService = {
  startScheduler,
  runDueAccrualForBranch,
  runDueAccrualSweep,
};
