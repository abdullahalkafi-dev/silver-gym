import { StatusCodes } from "http-status-codes";
import mongoose, { Types } from "mongoose";

import AppError from "../../errors/AppError";
import { logger } from "../../logger/logger";
import cacheService from "../../redis-client/cacheService";
import { BranchRepository } from "../branch/branch.repository";
import { BusinessProfileRepository } from "../businessProfile/businessProfile.repository";
import { Member } from "../member/member.model";
import {
  alignMemberBillingLedgerToDueAmount,
  mergeMemberBillingLedgerMetadata,
  readMemberBillingLedger,
  sumMemberBillingLedger,
  TMemberBillingLedgerItem,
  TMemberBillingLedgerItemType,
} from "../member/member.billingLedger";
import { TMember } from "../member/member.interface";
import { MemberRepository } from "../member/member.repository";
import { TStaff } from "../staff/staff.interface";
import { normalizeMoney, startOfCalendarMonth } from "./payment.balance";
import { PaymentMethod, PaymentStatus, PaymentType, TPayment } from "./payment.interface";
import { InvoiceCounterService } from "./invoiceCounter.service";
import { PaymentRepository } from "./payment.repository";

type TAccessActor = {
  userId?: Types.ObjectId;
  staff?: TStaff;
};

type TSettleDuePayload = {
  parentPaymentId: string;
  paidTotal: number;
  paymentMethod: PaymentMethod;
  paymentDate?: Date | string;
  note?: string;
};

type TSettleDueResult = {
  settlementPayment: TPayment;
  updatedParentPayment: TPayment;
  member: TMember & { _id?: unknown };
  billing: {
    currentDueAmount: number;
    nextPaymentDate?: Date;
  };
};

export type TDuePaymentSummary = {
  payment: TPayment;
  settlements: TPayment[];
  totalSettled: number;
  remainingDue: number;
};

const isTransactionNotSupported = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return (
    message.includes("transaction numbers are only allowed") ||
    message.includes("transactions are not supported") ||
    message.includes("replica set")
  );
};

const getBillingReconcileCacheKey = (branchId: string) =>
  `members:${branchId}:billing-reconciled`;

const invalidateMemberBillingCaches = async (
  branchId: string,
  memberId: string,
) => {
  try {
    await Promise.all([
      cacheService.deleteCache(`members:${branchId}:${memberId}`),
      cacheService.deleteCache(getBillingReconcileCacheKey(branchId)),
      cacheService.invalidateByPattern(`members:${branchId}:list:*`),
      cacheService.invalidateByPattern(`analytics:${branchId}:*`),
    ]);
  } catch (error) {
    logger.warn("Failed to invalidate billing caches (will auto-expire)", {
      branchId,
      memberId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

const generateInvoiceNo = async (
  session?: mongoose.ClientSession | null,
): Promise<string> => {
  const sequence = await InvoiceCounterService.getNextInvoiceSequence(
    "PAYMENT",
    session,
  );
  return `PAY-${String(sequence).padStart(12, "0")}`;
};

const resolveBranchAccess = async (branchId: string, actor: TAccessActor) => {
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
      throw new AppError(StatusCodes.FORBIDDEN, "You do not have permission to access this branch");
    }
    return branch;
  }

  if (actor.staff) {
    if (!actor.staff.isActive) {
      throw new AppError(StatusCodes.FORBIDDEN, "Staff account is inactive");
    }
    if (String(actor.staff.branchId) !== String(branch._id)) {
      throw new AppError(StatusCodes.FORBIDDEN, "You do not have permission to access this branch");
    }
    return branch;
  }

  throw new AppError(StatusCodes.UNAUTHORIZED, "You are not authorized");
};

const computePaymentStatus = (
  dueAmount: number,
  paidTotal: number,
): PaymentStatus => {
  if (dueAmount <= 0) {
    return PaymentStatus.PAID;
  }
  if (paidTotal <= 0) {
    return PaymentStatus.DUE;
  }
  return PaymentStatus.PARTIAL;
};

const findMatchingLedgerItem = (
  items: TMemberBillingLedgerItem[],
  parentPayment: TPayment,
): TMemberBillingLedgerItem | undefined => {
  const paymentType = parentPayment.paymentType;

  const targetTypeMap: Record<string, TMemberBillingLedgerItemType[]> = {
    [PaymentType.MONTHLY]: ["monthly_cycle_due"],
    [PaymentType.PACKAGE]: ["package_due"],
    [PaymentType.ADMISSION]: ["admission_due"],
    [PaymentType.OTHER]: ["monthly_cycle_due", "package_due", "carry_forward"],
    [PaymentType.LOCKER]: ["monthly_cycle_due", "package_due"],
    [PaymentType.REGISTRATION]: ["monthly_cycle_due", "package_due"],
  };

  const targetTypes = targetTypeMap[paymentType || ""] || [
    "monthly_cycle_due",
    "package_due",
  ];

  const parentPeriodStart = parentPayment.periodStart
    ? new Date(parentPayment.periodStart)
    : null;
  const parentPackageId = parentPayment.packageId
    ? String(parentPayment.packageId)
    : null;

  // First pass: exact match by type + periodStart month (Dhaka timezone)
  if (parentPeriodStart && !Number.isNaN(parentPeriodStart.getTime())) {
    const parentDhakaMonth = startOfCalendarMonth(parentPeriodStart).getTime();
    for (const item of items) {
      if (!targetTypes.includes(item.type) || item.remainingAmount <= 0) {
        continue;
      }
      if (item.periodStart) {
        const itemDate = new Date(item.periodStart);
        const itemDhakaMonth = startOfCalendarMonth(itemDate).getTime();
        if (itemDhakaMonth === parentDhakaMonth) {
          return item;
        }
      }
    }
  }

  // Second pass: match by type + packageId
  if (parentPackageId) {
    for (const item of items) {
      if (!targetTypes.includes(item.type) || item.remainingAmount <= 0) {
        continue;
      }
      if (item.packageId && String(item.packageId) === parentPackageId) {
        return item;
      }
    }
  }

  // Third pass: any item with matching type
  for (const item of items) {
    if (targetTypes.includes(item.type) && item.remainingAmount > 0) {
      return item;
    }
  }

  return undefined;
};

const reduceLedgerForSettlement = (
  items: TMemberBillingLedgerItem[],
  amount: number,
  parentPayment: TPayment,
): TMemberBillingLedgerItem[] => {
  let remaining = normalizeMoney(amount);
  const nextItems = items.map((item) => ({ ...item }));

  // First: reduce the matching item
  const matched = findMatchingLedgerItem(nextItems, parentPayment);
  if (matched) {
    const reduction = Math.min(matched.remainingAmount, remaining);
    matched.remainingAmount = normalizeMoney(matched.remainingAmount - reduction);
    remaining = normalizeMoney(remaining - reduction);
  }

  // If still remaining, reduce by priority order
  if (remaining > 0) {
    const priorityOrder: TMemberBillingLedgerItemType[] = [
      "admission_due",
      "carry_forward",
      "monthly_due",
      "monthly_cycle_due",
      "package_due",
    ];

    const sorted = [...nextItems].sort((a, b) => {
      const aIdx = priorityOrder.indexOf(a.type);
      const bIdx = priorityOrder.indexOf(b.type);
      if (aIdx !== bIdx) return aIdx - bIdx;
      const aDate = a.dueDate || a.createdAt;
      const bDate = b.dueDate || b.createdAt;
      return aDate.localeCompare(bDate);
    });

    for (const item of sorted) {
      if (remaining <= 0) break;
      if (item.remainingAmount <= 0) continue;
      const reduction = Math.min(item.remainingAmount, remaining);
      item.remainingAmount = normalizeMoney(item.remainingAmount - reduction);
      remaining = normalizeMoney(remaining - reduction);
    }
  }

  return nextItems;
};

const isAdmissionPayment = (
  payment: TPayment,
): boolean => {
  // Payment type is explicitly admission
  if (payment.paymentType === PaymentType.ADMISSION) {
    return true;
  }

  // Payment has admissionFee > 0 — it's an admission payment
  if (payment.admissionFee && payment.admissionFee > 0) {
    return true;
  }

  return false;
};

export const getMemberDuePayments = async (
  branchId: string,
  memberId: string,
  actor: TAccessActor,
): Promise<TDuePaymentSummary[]> => {
  await resolveBranchAccess(branchId, actor);

  const member = await MemberRepository.findOne({
    _id: new Types.ObjectId(memberId),
    branchId: new Types.ObjectId(branchId),
  });

  if (!member) {
    throw new AppError(StatusCodes.NOT_FOUND, "Member not found");
  }

  // Find all Payments with remaining due
  const duePayments = await PaymentRepository.findMany({
    branchId: new Types.ObjectId(branchId),
    memberId: new Types.ObjectId(memberId),
    dueAmount: { $gt: 0 },
    status: { $in: [PaymentStatus.PARTIAL, PaymentStatus.DUE] },
    "metadata.entryKind": { $nin: ["opening_import_balance", "due_settlement"] },
  });

  if (duePayments.length === 0) {
    return [];
  }

  // Read billing ledger to identify admission dues
  const ledger = readMemberBillingLedger(member);

  // Filter out admission payments from the list (they go to Tab 1)
  const admissionPayments = duePayments.filter(
    (payment) => isAdmissionPayment(payment),
  );
  const nonAdmissionPayments = duePayments.filter(
    (payment) => !isAdmissionPayment(payment),
  );

  // Zero out stale admission Payments whose ledger items are already 0
  // (collectBill doesn't update existing Payment records, so they can become stale)
  for (const admPayment of admissionPayments) {
    const matchedLedger = findMatchingLedgerItem(ledger.items, admPayment);
    const ledgerRemaining = matchedLedger ? normalizeMoney(matchedLedger.remainingAmount) : 0;
    if (ledgerRemaining <= 0 && normalizeMoney(admPayment.dueAmount ?? 0) > 0) {
      try {
        await PaymentRepository.updateById(String((admPayment as unknown as Record<string, unknown>)._id), {
          dueAmount: 0,
          status: PaymentStatus.PAID,
        });
      } catch (e) {
        logger.warn("Failed to zero out stale admission payment", {
          paymentId: String((admPayment as unknown as Record<string, unknown>)._id),
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  if (nonAdmissionPayments.length === 0) {
    return [];
  }

  // Batch query all settlements for all parent IDs (avoids N+1)
  const parentIds = nonAdmissionPayments.map((p) => String(p._id));
  const allSettlements = await PaymentRepository.findMany({
    branchId: new Types.ObjectId(branchId),
    memberId: new Types.ObjectId(memberId),
    "metadata.parentPaymentId": { $in: parentIds },
    "metadata.entryKind": "due_settlement",
    status: { $ne: PaymentStatus.CANCELLED },
  });

  // Group settlements by parentPaymentId
  const settlementsByParent = new Map<string, TPayment[]>();
  for (const settlement of allSettlements) {
    const parentId = settlement.metadata?.parentPaymentId as string;
    if (parentId) {
      const existing = settlementsByParent.get(parentId) || [];
      existing.push(settlement);
      settlementsByParent.set(parentId, existing);
    }
  }

  // Build results — use ledger as source of truth for remainingDue
  const results: TDuePaymentSummary[] = [];

  for (const payment of nonAdmissionPayments) {
    const matchedLedgerItem = findMatchingLedgerItem(ledger.items, payment);
    const ledgerRemaining = matchedLedgerItem
      ? normalizeMoney(matchedLedgerItem.remainingAmount)
      : 0;

    // If ledger says no remaining due, skip and zero out stale Payment
    if (ledgerRemaining <= 0) {
      if (normalizeMoney(payment.dueAmount ?? 0) > 0) {
        try {
          await PaymentRepository.updateById(String((payment as unknown as Record<string, unknown>)._id), {
            dueAmount: 0,
            status: PaymentStatus.PAID,
          });
        } catch (e) {
          logger.warn("Failed to zero out stale payment", {
            paymentId: String((payment as unknown as Record<string, unknown>)._id),
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
      continue;
    }

    const settlements = settlementsByParent.get(String(payment._id)) || [];
    const totalSettled = normalizeMoney(
      settlements.reduce((sum, s) => sum + (s.paidTotal ?? 0), 0),
    );

    results.push({
      payment,
      settlements,
      totalSettled,
      remainingDue: ledgerRemaining, // Use ledger, not Payment.dueAmount
    });
  }

  return results;
};

const settleDuePaymentCore = async (
  branchId: string,
  actor: TAccessActor,
  payload: TSettleDuePayload,
): Promise<TSettleDueResult> => {
  await resolveBranchAccess(branchId, actor);

  // Find and validate parent payment
  const parentPayment = await PaymentRepository.findOne({
    _id: new Types.ObjectId(payload.parentPaymentId),
    branchId: new Types.ObjectId(branchId),
  });

  if (!parentPayment) {
    throw new AppError(StatusCodes.NOT_FOUND, "Parent payment not found");
  }

  if (!parentPayment.memberId) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Payment has no associated member");
  }

  if (
    parentPayment.status === PaymentStatus.CANCELLED ||
    parentPayment.status === PaymentStatus.REFUNDED
  ) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Cannot settle a cancelled or refunded payment");
  }

  if (parentPayment.metadata?.entryKind === "due_settlement") {
    throw new AppError(StatusCodes.BAD_REQUEST, "Cannot settle a settlement payment");
  }

  const parentDueAmount = normalizeMoney(parentPayment.dueAmount ?? 0);
  if (parentDueAmount <= 0) {
    throw new AppError(StatusCodes.BAD_REQUEST, "This payment has no remaining due");
  }

  // Read billing ledger to get the actual remaining due (source of truth)
  const member = await MemberRepository.findOne({
    _id: parentPayment.memberId,
    branchId: new Types.ObjectId(branchId),
  });
  if (!member) {
    throw new AppError(StatusCodes.NOT_FOUND, "Member not found");
  }

  const ledger = readMemberBillingLedger(member);
  const matchedLedgerItem = findMatchingLedgerItem(ledger.items, parentPayment);
  const ledgerRemaining = matchedLedgerItem
    ? normalizeMoney(matchedLedgerItem.remainingAmount)
    : 0;

  if (ledgerRemaining <= 0) {
    throw new AppError(StatusCodes.BAD_REQUEST, "This payment's due has already been settled");
  }

  const paidTotal = normalizeMoney(payload.paidTotal);
  if (paidTotal <= 0) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Paid amount must be greater than 0");
  }

  // Validate against the smaller of Payment.dueAmount and ledger remaining
  const maxPayable = normalizeMoney(Math.min(parentDueAmount, ledgerRemaining));
  if (paidTotal > maxPayable) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      `Paid amount (${paidTotal}) cannot exceed the remaining due (${maxPayable})`,
    );
  }

  const paymentDate =
    payload.paymentDate instanceof Date
      ? payload.paymentDate
      : payload.paymentDate
        ? new Date(payload.paymentDate)
        : new Date();

  const newParentDue = normalizeMoney(parentDueAmount - paidTotal);
  const newParentStatus = computePaymentStatus(newParentDue, parentPayment.paidTotal ?? 0);

  const memberId = String(parentPayment.memberId);
  const invoiceNo = await generateInvoiceNo();

  // Build settlement payment data
  const settlementData: TPayment = {
    branchId: new Types.ObjectId(branchId),
    invoiceNo,
    memberId: parentPayment.memberId,
    memberName: parentPayment.memberName,
    paymentType: PaymentType.DUE_SETTLEMENT,
    paidTotal,
    dueAmount: 0,
    billAmount: paidTotal,
    paymentMethod: payload.paymentMethod,
    paymentDate,
    status: PaymentStatus.PAID,
    source: "MANUAL",
    metadata: {
      entryKind: "due_settlement",
      parentPaymentId: String(parentPayment._id),
      parentInvoiceNo: parentPayment.invoiceNo,
      parentPaymentType: parentPayment.paymentType,
      note: payload.note,
    },
  };

  // Try transaction first, fall back to sequential writes
  let session: mongoose.ClientSession | null = null;
  let settlementPayment: TPayment;
  let updatedParent: TPayment;

  try {
    session = await mongoose.startSession();
    session.startTransaction();

    settlementPayment = await PaymentRepository.create(settlementData, { session });

    const parentDoc = await PaymentRepository.updateById(
      String(parentPayment._id),
      {
        dueAmount: newParentDue,
        status: newParentStatus,
      },
      { session },
    );
    updatedParent = parentDoc!;

    // Update member's currentDueAmount (use Model directly for session support)
    const memberDoc = await Member.findById(memberId).session(session);
    if (memberDoc) {
      const newMemberDue = normalizeMoney(Math.max(0, (memberDoc.currentDueAmount ?? 0) - paidTotal));
      await Member.findByIdAndUpdate(
        memberId,
        { currentDueAmount: newMemberDue },
        { returnDocument: "after", runValidators: true, session },
      );
    }

    await session.commitTransaction();
  } catch (error) {
    if (session) {
      await session.abortTransaction();
    }

    if (!isTransactionNotSupported(error)) {
      throw error;
    }

    // Fallback: sequential writes without transaction
    logger.warn("MongoDB transactions not supported, using sequential writes for due settlement");

    settlementPayment = await PaymentRepository.create(settlementData);

    const parentDoc = await PaymentRepository.updateById(String(parentPayment._id), {
      dueAmount: newParentDue,
      status: newParentStatus,
    });
    updatedParent = parentDoc!;

    const memberDoc = await MemberRepository.findById(memberId);
    if (memberDoc) {
      const newMemberDue = normalizeMoney(Math.max(0, (memberDoc.currentDueAmount ?? 0) - paidTotal));
      await MemberRepository.updateById(memberId, { currentDueAmount: newMemberDue });
    }
  } finally {
    if (session) {
      await session.endSession();
    }
  }

  // Update billing ledger (outside transaction for performance)
  // Re-read ledger AFTER transaction to get latest state (avoid race with collectBill)
  try {
    const member = await MemberRepository.findById(memberId);
    if (member) {
      const currentLedger = readMemberBillingLedger(member);
      const nextItems = reduceLedgerForSettlement(
        currentLedger.items,
        paidTotal,
        parentPayment,
      );
      const newCurrentDue = sumMemberBillingLedger(nextItems);
      const alignedLedger = alignMemberBillingLedgerToDueAmount(
        nextItems,
        newCurrentDue,
        paymentDate,
      );

      await MemberRepository.updateById(memberId, {
        metadata: mergeMemberBillingLedgerMetadata(member.metadata, alignedLedger),
      });

      // If ledger says no more due but Payment still has dueAmount > 0,
      // zero out the Payment (handles stale Payment.dueAmount from collectBill)
      const finalLedgerRemaining = matchedLedgerItem
        ? normalizeMoney(nextItems.find(i => i.key === matchedLedgerItem.key)?.remainingAmount ?? 0)
        : 0;
      if (finalLedgerRemaining <= 0 && updatedParent && normalizeMoney(updatedParent.dueAmount ?? 0) > 0) {
        updatedParent = await PaymentRepository.updateById(
          String(parentPayment._id),
          { dueAmount: 0, status: PaymentStatus.PAID },
        ) ?? updatedParent;
      }
    }
  } catch (ledgerError) {
    logger.warn("Failed to update billing ledger after due settlement (will reconcile on next access)", {
      memberId,
      error: ledgerError instanceof Error ? ledgerError.message : String(ledgerError),
    });
  }

  await invalidateMemberBillingCaches(branchId, memberId);

  // Fetch updated member for response
  const updatedMember = await MemberRepository.findById(memberId);
  if (!updatedMember) {
    throw new AppError(StatusCodes.INTERNAL_SERVER_ERROR, "Failed to load updated member");
  }

  return {
    settlementPayment,
    updatedParentPayment: updatedParent,
    member: updatedMember,
    billing: {
      currentDueAmount: updatedMember.currentDueAmount ?? 0,
      nextPaymentDate: updatedMember.nextPaymentDate,
    },
  };
};

export const reverseSettlement = async (
  branchId: string,
  settlementPayment: TPayment,
): Promise<void> => {
  const parentPaymentId = settlementPayment.metadata?.parentPaymentId as string;
  if (!parentPaymentId) {
    return;
  }

  const settlementAmount = normalizeMoney(settlementPayment.paidTotal ?? 0);
  if (settlementAmount <= 0) {
    return;
  }

  const memberId = settlementPayment.memberId
    ? String(settlementPayment.memberId)
    : null;

  // Restore parent payment's dueAmount
  const parentPayment = await PaymentRepository.findOne({
    _id: new Types.ObjectId(parentPaymentId),
    branchId: new Types.ObjectId(branchId),
  });

  if (parentPayment) {
    const restoredDue = normalizeMoney((parentPayment.dueAmount ?? 0) + settlementAmount);

    // Don't restore status of a cancelled parent — keep it cancelled
    if (parentPayment.status === PaymentStatus.CANCELLED) {
      // Parent is cancelled: restore dueAmount but keep status as cancelled
      // so the parent stays cancelled as the admin intended.
      await PaymentRepository.updateById(parentPaymentId, {
        dueAmount: restoredDue,
      });
    } else {
      const restoredStatus = computePaymentStatus(restoredDue, parentPayment.paidTotal ?? 0);
      await PaymentRepository.updateById(parentPaymentId, {
        dueAmount: restoredDue,
        status: restoredStatus,
      });
    }
  }

  // Restore member's currentDueAmount
  if (memberId) {
    const member = await MemberRepository.findById(memberId);
    if (member) {
      const restoredMemberDue = normalizeMoney((member.currentDueAmount ?? 0) + settlementAmount);
      await MemberRepository.updateById(memberId, {
        currentDueAmount: restoredMemberDue,
      });

      // Restore ledger: increase the matching item
      // BUT only if the item's period is NOT covered by the current billing cycle
      // (collectBill clears ledger items for months covered by a new cycle)
      try {
        const ledger = readMemberBillingLedger(member);
        const items = ledger.items.map((item) => ({ ...item }));

        if (parentPayment) {
          const matched = findMatchingLedgerItem(items, parentPayment);
          if (matched) {
            // Check if this item's period is already covered by current billing cycle
            const itemPeriodEnd = matched.periodEnd ? new Date(matched.periodEnd) : null;
            const memberNextPayment = member.nextPaymentDate ? new Date(member.nextPaymentDate) : null;
            const isCoveredByCurrentCycle = itemPeriodEnd && memberNextPayment &&
              startOfCalendarMonth(itemPeriodEnd).getTime() <= startOfCalendarMonth(memberNextPayment).getTime();

            if (!isCoveredByCurrentCycle) {
              // Item period is not covered — safe to restore
              matched.remainingAmount = normalizeMoney(matched.remainingAmount + settlementAmount);
            } else {
              // Item period is covered by current cycle — don't restore ledger
              // The Payment's dueAmount and member's currentDueAmount are still restored above
              // The ledger will reconcile on next getCollectBillContext call
              logger.info("Skipping ledger restore — item period covered by current billing cycle", {
                memberId,
                itemKey: matched.key,
                itemPeriodEnd: matched.periodEnd,
                memberNextPaymentDate: member.nextPaymentDate,
              });
            }
          } else {
            // No matching item found — create a carry_forward
            items.push({
              key: `carry_forward:${Date.now()}`,
              type: "carry_forward",
              label: "Reversed settlement",
              originalAmount: settlementAmount,
              remainingAmount: settlementAmount,
              createdAt: new Date().toISOString(),
            });
          }
        }

        const newLedgerTotal = sumMemberBillingLedger(items);
        const alignedLedger = alignMemberBillingLedgerToDueAmount(
          items,
          newLedgerTotal,
          new Date(),
        );

        await MemberRepository.updateById(memberId, {
          metadata: mergeMemberBillingLedgerMetadata(member.metadata, alignedLedger),
        });
      } catch (ledgerError) {
        logger.warn("Failed to restore billing ledger after settlement reversal", {
          memberId,
          error: ledgerError instanceof Error ? ledgerError.message : String(ledgerError),
        });
      }

      await invalidateMemberBillingCaches(branchId, memberId);
    }
  }
};

export const DueSettlementService = {
  getMemberDuePayments,
  settleDuePayment: settleDuePaymentCore,
  reverseSettlement,
};
