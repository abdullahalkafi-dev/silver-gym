import { StatusCodes } from "http-status-codes";
import { Types } from "mongoose";

import { QueryBuilder } from "../../Builder/QueryBuilder";
import AppError from "../../errors/AppError";
import { BranchRepository } from "../branch/branch.repository";
import { BusinessProfileRepository } from "../businessProfile/businessProfile.repository";
import { MemberRepository } from "../member/member.repository";
import { PackageRepository } from "../package/package.repository";
import { TStaff } from "../staff/staff.interface";
import { PaymentStatus, TPayment } from "./payment.interface";
import { Payment } from "./payment.model";
import { PaymentRepository } from "./payment.repository";

type TAccessActor = {
  userId?: Types.ObjectId;
  staff?: TStaff;
};

type TCreatePaymentPayload = Omit<TPayment, "branchId" | "createdAt" | "updatedAt">;

type TUpdatePaymentPayload = Partial<
  Omit<
    TPayment,
    | "branchId"
    | "legacyId"
    | "memberId"
    | "memberLegacyId"
    | "packageId"
    | "packageLegacyId"
    | "createdAt"
    | "updatedAt"
  >
>;

type TQueryPayment = {
  searchTerm?: string;
  legacyId?: string;
  memberId?: string;
  memberLegacyId?: string;
  packageId?: string;
  paymentType?: string;
  paymentMethod?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  minAmount?: string;
  maxAmount?: string;
  year?: string;
  sort?: string;
  page?: string;
  limit?: string;
  fields?: string;
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
      throw new AppError(
        StatusCodes.FORBIDDEN,
        "You do not have permission to access this branch",
      );
    }

    return branch;
  }

  if (actor.staff) {
    if (!actor.staff.isActive) {
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

const computePaymentStatus = (
  dueAmount: number,
  paidTotal: number,
  requestedStatus?: PaymentStatus,
): PaymentStatus => {
  if (requestedStatus) {
    return requestedStatus;
  }

  if (dueAmount <= 0) {
    return PaymentStatus.PAID;
  }

  if (paidTotal <= 0) {
    return PaymentStatus.DUE;
  }

  return PaymentStatus.PARTIAL;
};

const generateInvoiceNo = async (branchId: string): Promise<string> => {
  const year = new Date().getFullYear();
  const count = await PaymentRepository.count({
    branchId: new Types.ObjectId(branchId),
  });

  return `INV-${year}-${String(count + 1).padStart(6, "0")}`;
};

const resolveMemberData = async (
  branchId: string,
  payload: TCreatePaymentPayload,
): Promise<{
  memberId?: Types.ObjectId;
  memberName?: string;
}> => {
  // If memberId is provided, fetch and validate member
  if (payload.memberId) {
    const member = await MemberRepository.findOne({
      _id: new Types.ObjectId(payload.memberId),
      branchId: new Types.ObjectId(branchId),
    });

    if (!member) {
      throw new AppError(StatusCodes.NOT_FOUND, "Member not found in this branch");
    }

    return {
      memberId: member._id as Types.ObjectId,
      memberName: member.fullName,
    };
  }

  // For imported payments with memberLegacyId, try to resolve
  if (payload.memberLegacyId) {
    const member = await MemberRepository.findOne({
      legacyId: payload.memberLegacyId,
      branchId: new Types.ObjectId(branchId),
    });

    if (member) {
      return {
        memberId: member._id as Types.ObjectId,
        memberName: member.fullName,
      };
    }
  }

  // Return whatever was provided (for imported data compatibility)
  return {
    memberName: payload.memberName,
  };
};

const resolvePackageData = async (
  branchId: string,
  payload: TCreatePaymentPayload,
): Promise<{
  packageId?: Types.ObjectId;
  packageName?: string;
  packageDuration?: number;
  packageDurationType?: string;
}> => {
  // If packageId is provided, fetch and validate package
  if (payload.packageId) {
    const packageDoc = await PackageRepository.findOne({
      _id: new Types.ObjectId(payload.packageId),
      branchId: new Types.ObjectId(branchId),
    });

    if (!packageDoc) {
      throw new AppError(StatusCodes.NOT_FOUND, "Package not found in this branch");
    }

    return {
      packageId: packageDoc._id as Types.ObjectId,
      packageName: packageDoc.title,
      packageDuration: packageDoc.duration,
      packageDurationType: packageDoc.durationType,
    };
  }

  // For imported payments with packageLegacyId, try to resolve
  if (payload.packageLegacyId) {
    const packageDoc = await PackageRepository.findOne({
      legacyId: payload.packageLegacyId,
      branchId: new Types.ObjectId(branchId),
    });

    if (packageDoc) {
      return {
        packageId: packageDoc._id as Types.ObjectId,
        packageName: packageDoc.title,
        packageDuration: packageDoc.duration,
        packageDurationType: packageDoc.durationType,
      };
    }
  }

  // Return whatever was provided (for imported data compatibility)
  return {
    packageName: payload.packageName,
    packageDuration: payload.packageDuration,
    packageDurationType: payload.packageDurationType,
  };
};

const createPayment = async (
  branchId: string,
  actor: TAccessActor,
  payload: TCreatePaymentPayload,
) => {
  await resolveBranchAccess(branchId, actor);

  // Resolve member and package data (handles both manual and imported)
  const memberData = await resolveMemberData(branchId, payload);
  const packageData = await resolvePackageData(branchId, payload);

  // Generate invoice number if not provided
  const invoiceNo = payload.invoiceNo || (await generateInvoiceNo(branchId));

  // Calculate due amount if not provided
  const discount = payload.discount || 0;
  const subTotal = payload.subTotal ?? 0;
  const paidTotal = payload.paidTotal ?? 0;
  const dueAmount =
    payload.dueAmount !== undefined
      ? payload.dueAmount
      : subTotal - paidTotal - discount;

  // Determine payment status
  const status = computePaymentStatus(dueAmount, paidTotal, payload.status);

  const paymentData: TPayment = {
    ...payload,
    ...memberData,
    ...packageData,
    branchId: new Types.ObjectId(branchId),
    invoiceNo,
    dueAmount,
    status,
    paymentDate: payload.paymentDate || new Date(),
    source: payload.source || "MANUAL",
  };

  const payment = await PaymentRepository.create(paymentData);

  return payment;
};

const getAllPayments = async (
  branchId: string,
  actor: TAccessActor,
  query: TQueryPayment,
) => {
  await resolveBranchAccess(branchId, actor);

  const paymentQuery = new QueryBuilder(
    Payment.find({ branchId: new Types.ObjectId(branchId) }),
    query,
  )
    .search(["invoiceNo", "memberName", "packageName"])
    .filter()
    .sort()
    .paginate()
    .fields();

  const result = await paymentQuery.modelQuery;
  const meta = await paymentQuery.countTotal();

  return {
    meta,
    result,
  };
};

const getPaymentById = async (
  branchId: string,
  paymentId: string,
  actor: TAccessActor,
) => {
  await resolveBranchAccess(branchId, actor);

  const payment = await PaymentRepository.findOne({
    _id: new Types.ObjectId(paymentId),
    branchId: new Types.ObjectId(branchId),
  });

  if (!payment) {
    throw new AppError(StatusCodes.NOT_FOUND, "Payment not found");
  }

  return payment;
};

const updatePayment = async (
  branchId: string,
  paymentId: string,
  actor: TAccessActor,
  payload: TUpdatePaymentPayload,
) => {
  await resolveBranchAccess(branchId, actor);

  const existingPayment = await PaymentRepository.findOne({
    _id: new Types.ObjectId(paymentId),
    branchId: new Types.ObjectId(branchId),
  });

  if (!existingPayment) {
    throw new AppError(StatusCodes.NOT_FOUND, "Payment not found");
  }

  // Recalculate due amount and status if financial fields are updated
  let updatedPayload = { ...payload };

  const subTotal = payload.subTotal ?? existingPayment.subTotal ?? 0;
  const paidTotal = payload.paidTotal ?? existingPayment.paidTotal ?? 0;
  const discount = payload.discount ?? existingPayment.discount ?? 0;

  if (payload.subTotal !== undefined || payload.paidTotal !== undefined || payload.discount !== undefined) {
    const dueAmount = payload.dueAmount ?? subTotal - paidTotal - discount;
    const status = payload.status ?? computePaymentStatus(dueAmount, paidTotal);

    updatedPayload = {
      ...updatedPayload,
      dueAmount,
      status,
    };
  }

  const updatedPayment = await PaymentRepository.updateById(paymentId, updatedPayload);

  if (!updatedPayment) {
    throw new AppError(StatusCodes.INTERNAL_SERVER_ERROR, "Failed to update payment");
  }

  return updatedPayment;
};

const cancelPayment = async (
  branchId: string,
  paymentId: string,
  actor: TAccessActor,
) => {
  await resolveBranchAccess(branchId, actor);

  const existingPayment = await PaymentRepository.findOne({
    _id: new Types.ObjectId(paymentId),
    branchId: new Types.ObjectId(branchId),
  });

  if (!existingPayment) {
    throw new AppError(StatusCodes.NOT_FOUND, "Payment not found");
  }

  if (existingPayment.status === PaymentStatus.CANCELLED) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Payment is already cancelled");
  }

  const cancelledPayment = await PaymentRepository.updateById(paymentId, {
    status: PaymentStatus.CANCELLED,
  });

  return cancelledPayment;
};

const refundPayment = async (
  branchId: string,
  paymentId: string,
  actor: TAccessActor,
) => {
  await resolveBranchAccess(branchId, actor);

  const existingPayment = await PaymentRepository.findOne({
    _id: new Types.ObjectId(paymentId),
    branchId: new Types.ObjectId(branchId),
  });

  if (!existingPayment) {
    throw new AppError(StatusCodes.NOT_FOUND, "Payment not found");
  }

  if (existingPayment.status === PaymentStatus.REFUNDED) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Payment is already refunded");
  }

  if (existingPayment.status === PaymentStatus.CANCELLED) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Cannot refund a cancelled payment");
  }

  const refundedPayment = await PaymentRepository.updateById(paymentId, {
    status: PaymentStatus.REFUNDED,
  });

  return refundedPayment;
};

export const PaymentService = {
  createPayment,
  getAllPayments,
  getPaymentById,
  updatePayment,
  cancelPayment,
  refundPayment,
};
