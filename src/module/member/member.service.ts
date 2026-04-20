import { StatusCodes } from "http-status-codes";
import mongoose, { Types } from "mongoose";

import { QueryBuilder } from "../../Builder/QueryBuilder";
import AppError from "../../errors/AppError";
import unlinkFile from "../../shared/unlinkFile";
import { BranchRepository } from "../branch/branch.repository";
import { BranchService } from "../branch/branch.service";
import { BusinessProfileRepository } from "../businessProfile/businessProfile.repository";
import { PackageDurationType } from "../package/package.interface";
import { PackageRepository } from "../package/package.repository";
import {
  PaymentStatus,
  PaymentType,
  TPayment,
} from "../payment/payment.interface";
import { PaymentRepository } from "../payment/payment.repository";
import { TStaff } from "../staff/staff.interface";
import { TMember } from "./member.interface";
import { MemberRepository } from "./member.repository";

type TCreatePaymentPayload = {
  paymentMethod: TPayment["paymentMethod"];
  paidTotal: number;
  discount?: number;
  admissionFee?: number;
  paymentDate?: Date;
  status?: PaymentStatus;
};

type TCreateMemberPayload = Omit<
  TMember,
  | "branchId"
  | "photo"
  | "currentPackageId"
  | "customMonthlyFeeAmount"
  | "createdAt"
  | "updatedAt"
> & {
  currentPackageId?: string;
  customMonthlyFeeAmount?: number;
  payment: TCreatePaymentPayload;
};

type TUpdateMemberPayload = Partial<
  Omit<
    TMember,
    "branchId" | "photo" | "currentPackageId" | "customMonthlyFeeAmount" | "createdAt" | "updatedAt"
  >
> & {
  currentPackageId?: string;
  customMonthlyFeeAmount?: number;
};

type TAccessActor = {
  userId?: Types.ObjectId;
  staff?: TStaff;
};

type TDashboardSummaryQuery = {
  days?: unknown;
};

const getPhotoRelativePath = (fullPath: string): string => {
  const relativePath = fullPath.replace(/\\/g, "/").split("uploads/")[1];
  return relativePath || fullPath;
};

const addDuration = (
  date: Date,
  duration: number,
  durationType: PackageDurationType,
): Date => {
  const nextDate = new Date(date);

  switch (durationType) {
    case PackageDurationType.DAY:
      nextDate.setDate(nextDate.getDate() + duration);
      break;
    case PackageDurationType.WEEK:
      nextDate.setDate(nextDate.getDate() + duration * 7);
      break;
    case PackageDurationType.MONTH:
      nextDate.setMonth(nextDate.getMonth() + duration);
      break;
    case PackageDurationType.YEAR:
      nextDate.setFullYear(nextDate.getFullYear() + duration);
      break;
    case PackageDurationType.CUSTOM:
      nextDate.setDate(nextDate.getDate() + duration);
      break;
    default:
      nextDate.setMonth(nextDate.getMonth() + duration);
      break;
  }

  return nextDate;
};

const addMonths = (date: Date, months: number): Date => {
  const nextDate = new Date(date);
  nextDate.setMonth(nextDate.getMonth() + months);
  return nextDate;
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

const resolveBranchAccess = async (
  branchId: string,
  actor: TAccessActor,
  photoFile?: Express.Multer.File,
) => {
  const branch = await BranchRepository.findOne({
    _id: new Types.ObjectId(branchId),
    isActive: true,
  });

  if (!branch) {
    if (photoFile) {
      await unlinkFile(getPhotoRelativePath(photoFile.path));
    }

    throw new AppError(StatusCodes.NOT_FOUND, "Branch not found");
  }

  if (actor.userId) {
    const business = await BusinessProfileRepository.findOne({
      _id: branch.businessId,
      userId: actor.userId,
    });

    if (!business) {
      if (photoFile) {
        await unlinkFile(getPhotoRelativePath(photoFile.path));
      }

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

const createMemberAndPayment = async (
  memberData: TMember,
  paymentData: Omit<TPayment, "memberId" | "memberName">,
) => {
  let session: mongoose.ClientSession | null = null;

  try {
    session = await mongoose.startSession();
    session.startTransaction();

    const member = await MemberRepository.create(memberData, { session });
    const payment = await PaymentRepository.create(
      {
        ...paymentData,
        memberId: member._id as Types.ObjectId,
        memberName: member.fullName,
      },
      { session },
    );

    await session.commitTransaction();

    return { member, payment };
  } catch (error) {
    if (session) {
      await session.abortTransaction();
    }

    if (!isTransactionNotSupported(error)) {
      throw error;
    }
  } finally {
    if (session) {
      await session.endSession();
    }
  }

  const member = await MemberRepository.create(memberData);

  try {
    const payment = await PaymentRepository.create({
      ...paymentData,
      memberId: member._id as Types.ObjectId,
      memberName: member.fullName,
    });

    return { member, payment };
  } catch {
    await MemberRepository.updateById(String(member._id), {
      isActive: false,
      metadata: {
        ...(member.metadata || {}),
        paymentConsistencyIssue: true,
      },
    });

    throw new AppError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      "Payment creation failed. Member moved to inactive state",
    );
  }
};

const createMember = async (
  branchId: string,
  actor: TAccessActor,
  payload: TCreateMemberPayload,
  photoFile?: Express.Multer.File,
) => {
  const branch = await resolveBranchAccess(branchId, actor, photoFile);
  BranchService.ensureBranchFeesConfigured(branch, "member");

  const membershipStartDate = payload.membershipStartDate
    ? new Date(payload.membershipStartDate)
    : new Date();

  const paymentInput = payload.payment;
  let currentPackageId: Types.ObjectId | undefined;
  let currentPackageName: string | undefined;
  let membershipEndDate: Date | undefined;
  let nextPaymentDate: Date | undefined;
  let packageDuration: number | undefined;
  let packageDurationType: string | undefined;
  let packageIdForPayment: Types.ObjectId | undefined;
  let paymentType: PaymentType;
  let periodEnd: Date;
  let subTotal = 0;
  let resolvedMonthlyFeeAmount: number | undefined;
  let paidMonthsForPayment: number | undefined;
  let resolvedAdmissionFeeAmount: number | undefined;

  if (payload.currentPackageId) {
    const packageDoc = await PackageRepository.findOne({
      _id: new Types.ObjectId(payload.currentPackageId),
      branchId: new Types.ObjectId(branchId),
      isActive: true,
    });

    if (!packageDoc) {
      if (photoFile) {
        await unlinkFile(getPhotoRelativePath(photoFile.path));
      }

      throw new AppError(StatusCodes.NOT_FOUND, "Package not found for this branch");
    }

    currentPackageId = packageDoc._id as Types.ObjectId;
    currentPackageName = packageDoc.title;
    packageDuration = packageDoc.duration;
    packageDurationType = packageDoc.durationType;
    packageIdForPayment = packageDoc._id as Types.ObjectId;
    membershipEndDate = addDuration(
      membershipStartDate,
      packageDoc.duration,
      packageDoc.durationType,
    );
    periodEnd = membershipEndDate;
    nextPaymentDate = membershipEndDate;
    paymentType = PaymentType.PACKAGE;
    paidMonthsForPayment = undefined;
    resolvedAdmissionFeeAmount =
      packageDoc.includeAdmissionFee && typeof branch.admissionFeeAmount === "number"
        ? branch.admissionFeeAmount
        : undefined;

    subTotal = packageDoc.amount + (resolvedAdmissionFeeAmount ?? 0);
  } else {
    // Monthly billing mode: triggered when no package is provided + paidMonths given
    const monthlyFeeFromPayload =
      typeof payload.customMonthlyFeeAmount === "number" ? payload.customMonthlyFeeAmount : undefined;
    const monthlyFeeFromBranch =
      typeof branch.monthlyFeeAmount === "number" ? branch.monthlyFeeAmount : undefined;

    resolvedMonthlyFeeAmount = monthlyFeeFromPayload ?? monthlyFeeFromBranch;

    if (resolvedMonthlyFeeAmount == null) {
      if (photoFile) {
        await unlinkFile(getPhotoRelativePath(photoFile.path));
      }

      throw new AppError(
        StatusCodes.BAD_REQUEST,
        "Monthly fee is required. Set customMonthlyFeeAmount or configure branch monthly fee",
      );
    }

    const paidMonths = payload.paidMonths && payload.paidMonths > 0 ? payload.paidMonths : 1;
    paidMonthsForPayment = paidMonths;
    periodEnd = addMonths(membershipStartDate, paidMonths);
    nextPaymentDate = periodEnd;
    paymentType = PaymentType.MONTHLY;
    resolvedAdmissionFeeAmount = paymentInput.admissionFee;
    subTotal = resolvedMonthlyFeeAmount * paidMonths + (resolvedAdmissionFeeAmount ?? 0);
  }

  const discount = paymentInput.discount ?? 0;
  const paidTotal = paymentInput.paidTotal ?? 0;
  const dueAmount = Math.max(subTotal - discount - paidTotal, 0);

  const memberPayload = {
    ...payload,
  } as Omit<TCreateMemberPayload, "payment" | "currentPackageId" | "customMonthlyFeeAmount"> & {
    customMonthlyFeeAmount?: number;
  };

  delete (memberPayload as Record<string, unknown>).payment;
  delete (memberPayload as Record<string, unknown>).currentPackageId;

  if (payload.isCustomMonthlyFee && payload.customMonthlyFeeAmount != null) {
    // Package member with a pre-stored custom monthly rate, OR monthly member with custom rate.
    memberPayload.isCustomMonthlyFee = true;
    memberPayload.customMonthlyFeeAmount = payload.customMonthlyFeeAmount;
  } else if (!payload.currentPackageId) {
    // Monthly billing with no custom rate override — store resolved branch rate
    memberPayload.isCustomMonthlyFee = false;
    memberPayload.customMonthlyFeeAmount = resolvedMonthlyFeeAmount;
  } else {
    // Package-only member, no custom fee configured yet
    delete (memberPayload as Record<string, unknown>).customMonthlyFeeAmount;
  }

  const memberData: TMember = {
    ...memberPayload,
    branchId: new Types.ObjectId(branchId),
    currentPackageId,
    currentPackageName,
    membershipStartDate,
    membershipEndDate,
    nextPaymentDate,
    isActive: true,
    source: payload.source || "app",
    photo: photoFile ? getPhotoRelativePath(photoFile.path) : undefined,
  };

  const paymentData: Omit<TPayment, "memberId" | "memberName"> = {
    branchId: new Types.ObjectId(branchId),
    packageId: packageIdForPayment,
    packageName: currentPackageName,
    packageDuration,
    packageDurationType,
    paymentType,
    periodStart: membershipStartDate,
    periodEnd,
    paidMonths: paidMonthsForPayment,
    year: membershipStartDate.getFullYear(),
    subTotal,
    discount,
    dueAmount,
    paidTotal,
    admissionFee: resolvedAdmissionFeeAmount,
    paymentMethod: paymentInput.paymentMethod,
    paymentDate: paymentInput.paymentDate || new Date(),
    nextPaymentDate,
    status: computePaymentStatus(dueAmount, paidTotal, paymentInput.status),
    source: payload.source || "app",
  };

  return createMemberAndPayment(memberData, paymentData);
};

const getMembers = async (
  branchId: string,
  actor: TAccessActor,
  query: Record<string, unknown>,
) => {
  await resolveBranchAccess(branchId, actor);

  const includeInactive =
    typeof query.includeInactive === "string" && query.includeInactive === "true";

  const sanitizedQuery = { ...query };
  delete sanitizedQuery.includeInactive;

  const baseFilter: Record<string, unknown> = {
    branchId: new Types.ObjectId(branchId),
  };

  if (!includeInactive) {
    baseFilter.isActive = true;
  }

  const queryBuilder = new QueryBuilder<TMember>(
    MemberRepository.findMany(baseFilter),
    sanitizedQuery,
    {
      filterableTextFields: ["fullName", "email", "contact", "memberId", "barcode"],
      allowedSortFields: ["fullName", "createdAt", "nextPaymentDate", "membershipStartDate"],
    },
  );

  if (query.searchTerm) {
    queryBuilder.search(["fullName", "email", "contact", "memberId", "barcode"]);
  }

  queryBuilder.filter().sort().paginate();

  const data = await queryBuilder.modelQuery.lean();
  const meta = await queryBuilder.countTotal();

  return {
    meta,
    data,
  };
};

const getMemberById = async (
  branchId: string,
  memberId: string,
  actor: TAccessActor,
  includeInactive = true,
) => {
  await resolveBranchAccess(branchId, actor);

  const member = await MemberRepository.findOne({
    _id: new Types.ObjectId(memberId),
    branchId: new Types.ObjectId(branchId),
    ...(includeInactive ? {} : { isActive: true }),
  });

  if (!member) {
    throw new AppError(StatusCodes.NOT_FOUND, "Member not found");
  }

  return member;
};

const updateMember = async (
  branchId: string,
  memberId: string,
  actor: TAccessActor,
  payload: TUpdateMemberPayload,
  photoFile?: Express.Multer.File,
) => {
  const branch = await resolveBranchAccess(branchId, actor, photoFile);

  const member = await MemberRepository.findOne({
    _id: new Types.ObjectId(memberId),
    branchId: new Types.ObjectId(branchId),
  });

  if (!member) {
    if (photoFile) {
      await unlinkFile(getPhotoRelativePath(photoFile.path));
    }

    throw new AppError(StatusCodes.NOT_FOUND, "Member not found");
  }

  const updatePayload: Record<string, unknown> = {
    ...payload,
  };

  const unsetPayload: Record<string, 1> = {};
  const branchMonthlyFeeAmount =
    typeof branch.monthlyFeeAmount === "number" ? branch.monthlyFeeAmount : undefined;

  // ─── PACKAGE UPDATE BRANCH ──────────────────────────────────────────────────
  if (payload.currentPackageId) {
    const packageDoc = await PackageRepository.findOne({
      _id: new Types.ObjectId(payload.currentPackageId),
      branchId: new Types.ObjectId(branchId),
      isActive: true,
    });

    if (!packageDoc) {
      if (photoFile) {
        await unlinkFile(getPhotoRelativePath(photoFile.path));
      }

      throw new AppError(StatusCodes.NOT_FOUND, "Package not found for this branch");
    }

    const membershipStartDate = payload.membershipStartDate
      ? new Date(payload.membershipStartDate)
      : member.membershipStartDate || new Date();

    updatePayload.currentPackageId = packageDoc._id as Types.ObjectId;
    updatePayload.currentPackageName = packageDoc.title;
    // NOTE: do NOT touch isCustomMonthlyFee / customMonthlyFeeAmount — they
    // store the member's personal rate that will apply after the package ends.
    updatePayload.membershipStartDate = membershipStartDate;
    updatePayload.membershipEndDate = addDuration(
      membershipStartDate,
      packageDoc.duration,
      packageDoc.durationType,
    );
    updatePayload.nextPaymentDate = updatePayload.membershipEndDate;
  }

  // ─── VALIDATION: standalone customMonthlyFeeAmount requires isCustomMonthlyFee ─
  if (
    typeof payload.customMonthlyFeeAmount === "number" &&
    payload.isCustomMonthlyFee !== true &&
    member.isCustomMonthlyFee !== true
  ) {
    if (photoFile) {
      await unlinkFile(getPhotoRelativePath(photoFile.path));
    }

    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "customMonthlyFeeAmount can only be set when isCustomMonthlyFee is true",
    );
  }

  // ─── MONTHLY BILLING TRANSITION ─────────────────────────────────────────────
  // Triggered when paidMonths is provided and no package is being assigned.
  const isSwitchingToMonthly =
    typeof payload.paidMonths === "number" &&
    payload.paidMonths > 0 &&
    !payload.currentPackageId;

  if (isSwitchingToMonthly) {
    // Fee resolution priority: new customMonthlyFeeAmount in payload → stored member rate → branch default
    const resolvedMonthlyFeeAmount =
      (typeof payload.customMonthlyFeeAmount === "number" ? payload.customMonthlyFeeAmount : undefined) ??
      (member.isCustomMonthlyFee && typeof member.customMonthlyFeeAmount === "number"
        ? member.customMonthlyFeeAmount
        : undefined) ??
      branchMonthlyFeeAmount;

    if (resolvedMonthlyFeeAmount == null) {
      if (photoFile) {
        await unlinkFile(getPhotoRelativePath(photoFile.path));
      }

      throw new AppError(
        StatusCodes.BAD_REQUEST,
        "Monthly fee is required. Set customMonthlyFeeAmount or configure branch monthly fee",
      );
    }

    const membershipStartDate = payload.membershipStartDate
      ? new Date(payload.membershipStartDate)
      : member.membershipStartDate || new Date();

    const paidMonths = Number(payload.paidMonths);

    updatePayload.membershipStartDate = membershipStartDate;
    updatePayload.paidMonths = paidMonths;
    updatePayload.nextPaymentDate = addMonths(membershipStartDate, paidMonths);
    // If the member had a custom rate, preserve/update it on the stored field
    if (member.isCustomMonthlyFee || payload.isCustomMonthlyFee) {
      updatePayload.isCustomMonthlyFee = true;
      updatePayload.customMonthlyFeeAmount = resolvedMonthlyFeeAmount;
    }

    // Clear package fields when transitioning to monthly billing
    unsetPayload.currentPackageId = 1;
    unsetPayload.currentPackageName = 1;
    unsetPayload.membershipEndDate = 1;
  }

  if (photoFile) {
    if (member.photo) {
      await unlinkFile(member.photo);
    }
    updatePayload.photo = getPhotoRelativePath(photoFile.path);
  }

  if (Object.keys(unsetPayload).length > 0) {
    updatePayload.$unset = unsetPayload;
  }

  const updatedMember = await MemberRepository.updateById(memberId, updatePayload);

  if (!updatedMember) {
    if (photoFile) {
      await unlinkFile(getPhotoRelativePath(photoFile.path));
    }

    throw new AppError(StatusCodes.INTERNAL_SERVER_ERROR, "Failed to update member");
  }

  return updatedMember;
};

const deleteMember = async (branchId: string, memberId: string, actor: TAccessActor) => {
  await resolveBranchAccess(branchId, actor);

  const member = await MemberRepository.findOne({
    _id: new Types.ObjectId(memberId),
    branchId: new Types.ObjectId(branchId),
  });

  if (!member) {
    throw new AppError(StatusCodes.NOT_FOUND, "Member not found");
  }

  const deletedMember = await MemberRepository.updateById(memberId, {
    isActive: false,
  });

  if (!deletedMember) {
    throw new AppError(StatusCodes.INTERNAL_SERVER_ERROR, "Failed to delete member");
  }

  return deletedMember;
};

const restoreMember = async (branchId: string, memberId: string, actor: TAccessActor) => {
  await resolveBranchAccess(branchId, actor);

  const member = await MemberRepository.findOne({
    _id: new Types.ObjectId(memberId),
    branchId: new Types.ObjectId(branchId),
  });

  if (!member) {
    throw new AppError(StatusCodes.NOT_FOUND, "Member not found");
  }

  const restoredMember = await MemberRepository.updateById(memberId, {
    isActive: true,
  });

  if (!restoredMember) {
    throw new AppError(StatusCodes.INTERNAL_SERVER_ERROR, "Failed to restore member");
  }

  return restoredMember;
};

const getDashboardMemberSummary = async (
  branchId: string,
  actor: TAccessActor,
  query: TDashboardSummaryQuery,
) => {
  await resolveBranchAccess(branchId, actor);

  const branchObjectId = new Types.ObjectId(branchId);
  const parsedDays = Number(query.days);
  const days = Number.isFinite(parsedDays) && parsedDays > 0
    ? Math.min(Math.floor(parsedDays), 90)
    : 7;

  const now = new Date();
  const dueSoonDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const windowStart = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  const [
    totalMembers,
    activeMembers,
    inactiveMembers,
    importDraftMembers,
    newMembersInWindow,
    paymentDueNow,
    paymentDueSoon,
  ] = await Promise.all([
    MemberRepository.count({ branchId: branchObjectId }),
    MemberRepository.count({ branchId: branchObjectId, isActive: true }),
    MemberRepository.count({ branchId: branchObjectId, isActive: false }),
    MemberRepository.count({
      branchId: branchObjectId,
      isActive: false,
      source: "google_sheet",
    }),
    MemberRepository.count({
      branchId: branchObjectId,
      createdAt: { $gte: windowStart },
    }),
    MemberRepository.count({
      branchId: branchObjectId,
      isActive: true,
      nextPaymentDate: { $lte: now },
    }),
    MemberRepository.count({
      branchId: branchObjectId,
      isActive: true,
      nextPaymentDate: {
        $gt: now,
        $lte: dueSoonDate,
      },
    }),
  ]);

  return {
    windowDays: days,
    members: {
      totalMembers,
      activeMembers,
      inactiveMembers,
      importDraftMembers,
      newMembersInWindow,
    },
    billing: {
      paymentDueNow,
      paymentDueSoon,
    },
  };
};

export const MemberService = {
  createMember,
  getMembers,
  getMemberById,
  updateMember,
  deleteMember,
  restoreMember,
  getDashboardMemberSummary,
};
