import { Types } from "mongoose";
import { StatusCodes } from "http-status-codes";
import mongoose from "mongoose";

import AppError from "../../errors/AppError";
import { LockerRepository } from "./locker.repository";
import { LockerStatus, TLocker } from "./locker.interface";
import { BranchRepository } from "../branch/branch.repository";
import { MemberRepository } from "../member/member.repository";
import { PaymentRepository } from "../payment/payment.repository";
import { PaymentType, PaymentStatus, PaymentMethod } from "../payment/payment.interface";
import { InvoiceCounterService } from "../payment/invoiceCounter.service";
import cacheService from "../../redis-client/cacheService";

type TAccessActor = {
  userId?: Types.ObjectId;
  staff?: { _id: string; branchId?: string; roleName?: string };
};

// ─── Helpers ────────────────────────────────────────────────────────────────

const resolveBranchAccess = async (branchId: string, _actor: TAccessActor) => {
  const branch = await BranchRepository.findById(branchId);
  if (!branch) {
    throw new AppError(StatusCodes.NOT_FOUND, "Branch not found");
  }
  return branch;
};

const generateLockerInvoiceNo = async (
  session?: mongoose.ClientSession | null,
): Promise<string> => {
  const sequence = await InvoiceCounterService.getNextInvoiceSequence(
    "LOCKER",
    session,
  );
  return `LKR-${String(sequence).padStart(12, "0")}`;
};

const resolveLockerPrice = (
  locker: TLocker,
  branchLockerFee: number,
): number => {
  return locker.isCustomPrice ? locker.customPrice : branchLockerFee;
};

const getNextBillingDate = (months: number): Date => {
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth() + months, 1);
  return target;
};

const getNextBillingDateFrom = (startDate: Date, months: number): Date => {
  return new Date(startDate.getFullYear(), startDate.getMonth() + months, 1);
};

const invalidateLockerCache = async (branchId: string) => {
  await Promise.all([
    cacheService.invalidateByPattern(`lockers:${branchId}*`),
    cacheService.deleteCache(`locker-stats:${branchId}`),
  ]);
};

// ─── Create Lockers ─────────────────────────────────────────────────────────

const createLockers = async (
  branchId: string,
  actor: TAccessActor,
  count: number,
) => {
  const branch = await resolveBranchAccess(branchId, actor);

  if (!branch.lockerFeeAmount || branch.lockerFeeAmount <= 0) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "Please set a default locker price before creating lockers",
    );
  }

  const maxNumber = await LockerRepository.getMaxLockerNumber(branchId);

  const lockers: Partial<TLocker>[] = [];
  for (let i = 1; i <= count; i++) {
    lockers.push({
      branchId: new Types.ObjectId(branchId),
      lockerNumber: maxNumber + i,
      status: LockerStatus.AVAILABLE,
      isCustomPrice: false,
      customPrice: 0,
      isDeleted: false,
    });
  }

  const created = await LockerRepository.createMany(lockers);
  await invalidateLockerCache(branchId);
  return created;
};

// ─── Get Lockers ────────────────────────────────────────────────────────────

const getLockers = async (
  branchId: string,
  filters?: { status?: LockerStatus; search?: string },
) => {
  const cacheKey = `lockers:${branchId}:${filters?.status || "all"}:${filters?.search || ""}`;
  const cached = await cacheService.getCache<TLocker[]>(cacheKey);
  if (cached) return cached;

  const lockers = await LockerRepository.findByBranch(branchId, filters);
  await cacheService.setCache(cacheKey, lockers, 300);
  return lockers;
};

// ─── Get Single Locker ──────────────────────────────────────────────────────

const getLockerById = async (branchId: string, lockerId: string) => {
  const locker = await LockerRepository.findById(lockerId);
  if (!locker) {
    throw new AppError(StatusCodes.NOT_FOUND, "Locker not found");
  }
  if (String(locker.branchId) !== branchId) {
    throw new AppError(StatusCodes.FORBIDDEN, "Locker does not belong to this branch");
  }
  return locker;
};

// ─── Update Locker ──────────────────────────────────────────────────────────

const updateLocker = async (
  branchId: string,
  lockerId: string,
  _actor: TAccessActor,
  payload: { status?: LockerStatus; lockerNumber?: number },
) => {
  const locker = await LockerRepository.findById(lockerId);
  if (!locker) {
    throw new AppError(StatusCodes.NOT_FOUND, "Locker not found");
  }
  if (String(locker.branchId) !== branchId) {
    throw new AppError(StatusCodes.FORBIDDEN, "Locker does not belong to this branch");
  }

  if (
    payload.lockerNumber &&
    payload.lockerNumber !== locker.lockerNumber
  ) {
    const existing = await LockerRepository.findOne({
      branchId: locker.branchId,
      lockerNumber: payload.lockerNumber,
      isDeleted: false,
    });
    if (existing) {
      throw new AppError(
        StatusCodes.CONFLICT,
        `Locker number ${payload.lockerNumber} already exists`,
      );
    }
  }

  if (
    payload.status === LockerStatus.AVAILABLE &&
    locker.status === LockerStatus.OCCUPIED
  ) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "Cannot set occupied locker to available. Unassign the member first.",
    );
  }

  const updated = await LockerRepository.updateById(lockerId, payload);
  await invalidateLockerCache(String(locker.branchId));
  return updated;
};

// ─── Set Branch Locker Price ────────────────────────────────────────────────

const setBranchLockerPrice = async (
  branchId: string,
  actor: TAccessActor,
  price: number,
) => {
  await resolveBranchAccess(branchId, actor);
  const updated = await BranchRepository.updateById(branchId, {
    lockerFeeAmount: price,
  });

  await cacheService.deleteCache(`branch:${branchId}`);
  return updated;
};

// ─── Set Custom Locker Price ────────────────────────────────────────────────

const setCustomLockerPrice = async (
  branchId: string,
  lockerId: string,
  _actor: TAccessActor,
  price: number,
) => {
  const locker = await LockerRepository.findById(lockerId);
  if (!locker) {
    throw new AppError(StatusCodes.NOT_FOUND, "Locker not found");
  }
  if (String(locker.branchId) !== branchId) {
    throw new AppError(StatusCodes.FORBIDDEN, "Locker does not belong to this branch");
  }

  const updated = await LockerRepository.updateById(lockerId, {
    isCustomPrice: true,
    customPrice: price,
  });

  await invalidateLockerCache(String(locker.branchId));
  return updated;
};

// ─── Reset To System Price ──────────────────────────────────────────────────

const resetToSystemPrice = async (branchId: string, lockerId: string, _actor: TAccessActor) => {
  const locker = await LockerRepository.findById(lockerId);
  if (!locker) {
    throw new AppError(StatusCodes.NOT_FOUND, "Locker not found");
  }
  if (String(locker.branchId) !== branchId) {
    throw new AppError(StatusCodes.FORBIDDEN, "Locker does not belong to this branch");
  }

  const updated = await LockerRepository.updateById(lockerId, {
    isCustomPrice: false,
    customPrice: 0,
  });

  await invalidateLockerCache(String(locker.branchId));
  return updated;
};

// ─── Assign Member ──────────────────────────────────────────────────────────

const assignMember = async (
  branchId: string,
  lockerId: string,
  actor: TAccessActor,
  payload: {
    memberId: string;
    months: number;
    paymentAmount: number;
    paymentMethod: PaymentMethod;
    discount: number;
    paidAmount: number;
    note?: string;
  },
) => {
  const branch = await resolveBranchAccess(branchId, actor);

  const [locker, member] = await Promise.all([
    LockerRepository.findById(lockerId),
    MemberRepository.findOne({
      _id: new Types.ObjectId(payload.memberId),
      branchId: new Types.ObjectId(branchId),
    }),
  ]);

  if (!locker) {
    throw new AppError(StatusCodes.NOT_FOUND, "Locker not found");
  }
  if (locker.status === LockerStatus.OCCUPIED) {
    throw new AppError(
      StatusCodes.CONFLICT,
      "Locker is already occupied by another member",
    );
  }
  if (!member) {
    throw new AppError(StatusCodes.NOT_FOUND, "Member not found in this branch");
  }

  const isCustom = payload.paymentAmount !== (branch.lockerFeeAmount || 0);

  const now = new Date();
  const nextBillingDate = getNextBillingDate(payload.months);

  const subTotal = Math.round(payload.paymentAmount * payload.months * 100) / 100;
  const totalDue = Math.round(Math.max(0, subTotal - payload.discount) * 100) / 100;

  if (payload.discount > subTotal) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Discount cannot exceed subtotal");
  }
  if (payload.paidAmount < totalDue) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Paid amount cannot be less than total due. Locker does not support partial payment.");
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const updatedLocker = await LockerRepository.updateById(
      lockerId,
      {
        status: LockerStatus.OCCUPIED,
        assignedMemberId: new Types.ObjectId(payload.memberId),
        assignedMemberName: member.fullName,
        assignedMemberCode: member.memberId || undefined,
        assignedAt: now,
        nextBillingDate,
        isCustomPrice: isCustom,
        customPrice: isCustom ? payload.paymentAmount : 0,
      },
      session,
    );

    const invoiceNo = await generateLockerInvoiceNo(session);

    const paidTotal = totalDue;
    const exchange = Math.round(Math.max(0, payload.paidAmount - totalDue) * 100) / 100;

    const paymentData = {
      branchId: new Types.ObjectId(branchId),
      invoiceNo,
      memberId: new Types.ObjectId(payload.memberId),
      memberName: member.fullName,
      paymentType: PaymentType.LOCKER,
      periodStart: now,
      periodEnd: nextBillingDate,
      paidMonths: payload.months,
      subTotal,
      discount: payload.discount,
      billAmount: totalDue,
      dueAmount: 0,
      paidTotal,
      exchange,
      paymentMethod: payload.paymentMethod as any,
      paymentDate: now,
      nextPaymentDate: nextBillingDate,
      status: PaymentStatus.PAID,
      source: "locker",
      metadata: {
        lockerId: lockerId,
        lockerNumber: locker.lockerNumber,
        isCustomPrice: isCustom,
        months: payload.months,
        note: payload.note,
      },
    };

    const payment = await PaymentRepository.create(paymentData, { session });

    await session.commitTransaction();

    await Promise.all([
      invalidateLockerCache(branchId),
      cacheService.deleteCache(`members:${branchId}:${payload.memberId}`),
    ]);

    return { locker: updatedLocker, payment };
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

// ─── Collect Locker Payment ─────────────────────────────────────────────────

const collectLockerPayment = async (
  branchId: string,
  lockerId: string,
  actor: TAccessActor,
  payload: {
    months: number;
    paymentAmount?: number;
    paymentMethod: PaymentMethod;
    discount: number;
    paidAmount: number;
    note?: string;
  },
) => {
  const branch = await resolveBranchAccess(branchId, actor);

  const locker = await LockerRepository.findById(lockerId);
  if (!locker) {
    throw new AppError(StatusCodes.NOT_FOUND, "Locker not found");
  }
  if (locker.status !== LockerStatus.OCCUPIED || !locker.assignedMemberId) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "No member is assigned to this locker",
    );
  }

  const member = await MemberRepository.findOne({
    _id: locker.assignedMemberId,
    branchId: new Types.ObjectId(branchId),
  });
  if (!member) {
    throw new AppError(StatusCodes.NOT_FOUND, "Assigned member not found");
  }

  const systemPrice = resolveLockerPrice(locker, branch.lockerFeeAmount || 0);
  const paymentAmount = payload.paymentAmount ?? systemPrice;

  const periodStart = locker.nextBillingDate || new Date();
  const nextBillingDate = getNextBillingDateFrom(periodStart, payload.months);

  const isEarlyCollection = locker.nextBillingDate != null && locker.nextBillingDate > new Date();

  const subTotal = Math.round(paymentAmount * payload.months * 100) / 100;
  const totalDue = Math.round(Math.max(0, subTotal - payload.discount) * 100) / 100;

  if (payload.discount > subTotal) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Discount cannot exceed subtotal");
  }
  if (payload.paidAmount < totalDue) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Paid amount cannot be less than total due. Locker does not support partial payment.");
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const invoiceNo = await generateLockerInvoiceNo(session);

    const paidTotal = totalDue;
    const exchange = Math.round(Math.max(0, payload.paidAmount - totalDue) * 100) / 100;

    const paymentData = {
      branchId: new Types.ObjectId(branchId),
      invoiceNo,
      memberId: locker.assignedMemberId,
      memberName: member.fullName,
      paymentType: PaymentType.LOCKER,
      periodStart,
      periodEnd: nextBillingDate,
      paidMonths: payload.months,
      subTotal,
      discount: payload.discount,
      billAmount: totalDue,
      dueAmount: 0,
      paidTotal,
      exchange,
      paymentMethod: payload.paymentMethod as any,
      paymentDate: new Date(),
      nextPaymentDate: nextBillingDate,
      status: PaymentStatus.PAID,
      source: "locker",
      metadata: {
        lockerId: lockerId,
        lockerNumber: locker.lockerNumber,
        isCustomPrice: locker.isCustomPrice,
        months: payload.months,
        note: payload.note,
      },
    };

    const payment = await PaymentRepository.create(paymentData, { session });

    const lockerUpdate: Partial<TLocker> = {
      nextBillingDate,
    };

    const updatedLocker = await LockerRepository.updateById(
      lockerId,
      lockerUpdate,
      session,
    );

    await session.commitTransaction();

    await Promise.all([
      invalidateLockerCache(branchId),
      cacheService.deleteCache(`members:${branchId}:${String(locker.assignedMemberId)}`),
    ]);

    return { locker: updatedLocker, payment, isEarlyCollection };
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

// ─── Unassign Member ────────────────────────────────────────────────────────

const unassignMember = async (
  branchId: string,
  lockerId: string,
  _actor: TAccessActor,
) => {
  const locker = await LockerRepository.findById(lockerId);
  if (!locker) {
    throw new AppError(StatusCodes.NOT_FOUND, "Locker not found");
  }
  if (String(locker.branchId) !== branchId) {
    throw new AppError(StatusCodes.FORBIDDEN, "Locker does not belong to this branch");
  }
  if (locker.status !== LockerStatus.OCCUPIED) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "Locker is not currently occupied",
    );
  }

  const now = new Date();
  const pendingPayments = await PaymentRepository.findMany({
    branchId: new Types.ObjectId(branchId),
    memberId: locker.assignedMemberId,
    paymentType: PaymentType.LOCKER,
    "metadata.lockerId": lockerId,
    status: { $ne: PaymentStatus.PAID },
    periodEnd: { $gt: now },
  });
  if (pendingPayments.length > 0) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "Cannot unassign member with pending locker payments for the current period. Collect or settle all payments first.",
    );
  }

  const updated = await LockerRepository.updateById(lockerId, {
    status: LockerStatus.AVAILABLE,
    assignedMemberId: undefined,
    assignedMemberName: undefined,
    assignedMemberCode: undefined,
    assignedAt: undefined,
    nextBillingDate: undefined,
  });

  await invalidateLockerCache(String(locker.branchId));
  return updated;
};

// ─── Delete Locker (Soft Delete) ────────────────────────────────────────────

const deleteLocker = async (
  branchId: string,
  lockerId: string,
  _actor: TAccessActor,
) => {
  const locker = await LockerRepository.findById(lockerId);
  if (!locker) {
    throw new AppError(StatusCodes.NOT_FOUND, "Locker not found");
  }
  if (String(locker.branchId) !== branchId) {
    throw new AppError(StatusCodes.FORBIDDEN, "Locker does not belong to this branch");
  }
  if (locker.status === LockerStatus.OCCUPIED) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "Cannot delete an occupied locker. Unassign the member first.",
    );
  }

  const updated = await LockerRepository.softDelete(lockerId);
  await invalidateLockerCache(String(locker.branchId));
  return updated;
};

// ─── Get Locker Stats ───────────────────────────────────────────────────────

const getLockerStats = async (branchId: string) => {
  const cacheKey = `locker-stats:${branchId}`;
  const cached = await cacheService.getCache<Record<string, number>>(cacheKey);
  if (cached) return cached;

  const stats = await LockerRepository.countByStatus(branchId);
  await cacheService.setCache(cacheKey, stats, 300);
  return stats;
};

// ─── Get Locker Payment History ─────────────────────────────────────────────

const getLockerPaymentHistory = async (branchId: string, lockerId: string) => {
  const locker = await LockerRepository.findById(lockerId);
  if (!locker) {
    throw new AppError(StatusCodes.NOT_FOUND, "Locker not found");
  }
  if (String(locker.branchId) !== branchId) {
    throw new AppError(StatusCodes.FORBIDDEN, "Locker does not belong to this branch");
  }

  const payments = await PaymentRepository.findMany(
    {
      branchId: locker.branchId,
      "metadata.lockerId": lockerId,
      paymentType: PaymentType.LOCKER,
    },
    { sort: { paymentDate: -1 } },
  );

  return payments;
};

export const LockerService = {
  createLockers,
  getLockers,
  getLockerById,
  updateLocker,
  setBranchLockerPrice,
  setCustomLockerPrice,
  resetToSystemPrice,
  assignMember,
  collectLockerPayment,
  unassignMember,
  deleteLocker,
  getLockerStats,
  getLockerPaymentHistory,
};
