import bcrypt from "bcryptjs";
import { StatusCodes } from "http-status-codes";
import { Types } from "mongoose";

import config from "../../config";
import AppError from "../../errors/AppError";
import { buildMemberIdPattern } from "../access/access.memberId";
import { normalizeMemberId } from "../access/access.policy";
import { Branch } from "../branch/branch.model";
import { BusinessProfile } from "../businessProfile/businessProfile.model";
import { Member } from "../member/member.model";
import { MemberService } from "../member/member.service";
import { Payment } from "../payment/payment.model";
import { Trainer } from "../trainer/trainer.model";
import { normalizeBangladeshPhone } from "../../utils/bangladeshPhone";
import { signPortalToken } from "./portal.auth";

const BAD_MEMBER_LOGIN = "Member ID or phone number is incorrect";
const BAD_TRAINER_LOGIN = "Username or password is incorrect";

// Branches of the one business this portal serves (re-read every few minutes).
let branchCache: { ids: Types.ObjectId[]; at: number } | null = null;
const BRANCH_CACHE_MS = 5 * 60 * 1000;

const getAccountBranchIds = async (): Promise<Types.ObjectId[]> => {
  const businessId = config.portal.business_id;
  if (!businessId || !Types.ObjectId.isValid(businessId)) {
    throw new AppError(StatusCodes.SERVICE_UNAVAILABLE, "Portal is not available right now");
  }

  if (branchCache && Date.now() - branchCache.at < BRANCH_CACHE_MS) {
    return branchCache.ids;
  }

  const branches = await Branch.find({
    businessId: new Types.ObjectId(businessId),
    isActive: true,
  })
    .select("_id")
    .lean();

  branchCache = { ids: branches.map((b) => b._id as Types.ObjectId), at: Date.now() };
  return branchCache.ids;
};

const memberLogin = async (payload: { memberId: string; phone: string }) => {
  const phone = normalizeBangladeshPhone(payload.phone);
  const key = normalizeMemberId(payload.memberId);
  if (!phone || !key) {
    throw new AppError(StatusCodes.UNAUTHORIZED, BAD_MEMBER_LOGIN);
  }

  const branchIds = await getAccountBranchIds();

  const matches = await Member.find({
    branchId: { $in: branchIds },
    isActive: true,
    contact: phone,
    memberId: { $regex: buildMemberIdPattern(key), $options: "i" },
  })
    .select("_id branchId fullName")
    .limit(2)
    .lean();

  if (matches.length === 0) {
    throw new AppError(StatusCodes.UNAUTHORIZED, BAD_MEMBER_LOGIN);
  }

  if (matches.length > 1) {
    // Same ID and phone in two branches: cannot tell who this is. Rare; ask them to contact the gym.
    throw new AppError(
      StatusCodes.CONFLICT,
      "We could not sign you in automatically. Please contact the gym front desk.",
    );
  }

  const member = matches[0]!;
  const token = signPortalToken({
    kind: "member",
    memberDbId: String(member._id),
    branchId: String(member.branchId),
  });

  return { token, kind: "member" as const, name: member.fullName };
};

const trainerLogin = async (payload: { username: string; password: string }) => {
  const branchIds = await getAccountBranchIds();

  const trainer = await Trainer.findOne({
    username: payload.username.trim().toLowerCase(),
    branchId: { $in: branchIds },
  })
    .select("+password")
    .lean();

  const valid =
    trainer?.password && (await bcrypt.compare(payload.password, trainer.password));

  if (!trainer || !valid) {
    throw new AppError(StatusCodes.UNAUTHORIZED, BAD_TRAINER_LOGIN);
  }

  if (!trainer.isActive) {
    throw new AppError(StatusCodes.UNAUTHORIZED, "This account is not active");
  }

  await Trainer.updateOne({ _id: trainer._id }, { $set: { lastLogin: new Date() } });

  const token = signPortalToken({
    kind: "trainer",
    trainerId: String(trainer._id),
    branchId: String(trainer.branchId),
  });

  return { token, kind: "trainer" as const, name: trainer.displayName };
};

const getTrainerMe = async (trainerId: string) => {
  const trainer = await Trainer.findById(trainerId).lean();
  if (!trainer) throw new AppError(StatusCodes.NOT_FOUND, "Trainer not found");
  const branch = await Branch.findById(trainer.branchId).select("branchName").lean();
  return {
    kind: "trainer" as const,
    displayName: trainer.displayName,
    username: trainer.username,
    phone: trainer.phone ?? null,
    branchName: branch?.branchName ?? null,
  };
};

const getMemberMe = async (memberDbId: string, branchId: string) => {
  const member: any = await MemberService.getMemberForPortal(branchId, memberDbId);

  const branch = await Branch.findById(branchId).select("branchName branchAddress businessId").lean();
  const business = branch
    ? await BusinessProfile.findById(branch.businessId)
        .select("businessName logo businessPhoneNumber")
        .lean()
    : null;

  return {
    kind: "member" as const,
    profile: {
      id: String(member._id),
      memberId: member.memberId ?? null,
      fullName: member.fullName,
      contact: member.contact ?? null,
      email: member.email ?? null,
      dateOfBirth: member.dateOfBirth ?? null,
      country: member.country ?? null,
      nid: member.nid ?? null,
      gender: member.gender ?? null,
      bloodGroup: member.bloodGroup ?? null,
      height: member.height ?? null,
      heightUnit: member.heightUnit ?? null,
      weight: member.weight ?? null,
      weightUnit: member.weightUnit ?? null,
      address: member.address ?? null,
      photo: member.photo ?? null,
      emergencyContact: member.emergencyContact ?? null,
      trainingGoals: member.trainingGoals ?? [],
      currentPackageName: member.currentPackageName ?? null,
      membershipStartDate: member.membershipStartDate ?? null,
      membershipEndDate: member.membershipEndDate ?? null,
      nextPaymentDate: member.nextPaymentDate ?? null,
      currentDueAmount: member.currentDueAmount ?? 0,
      joinedAt: member.createdAt ?? null,
    },
    branch: { name: branch?.branchName ?? "", address: branch?.branchAddress ?? "" },
    business: {
      name: business?.businessName ?? "Silver GYM",
      logo: business?.logo ?? null,
      phone: business?.businessPhoneNumber ?? null,
    },
  };
};

/** Real bills the member paid. Migration "opening balance" rows (paid 0) are hidden. */
const getMemberPayments = async (memberDbId: string) => {
  const payments = await Payment.find({
    memberId: new Types.ObjectId(memberDbId),
    "metadata.entryKind": { $ne: "opening_import_balance" },
    status: { $nin: ["cancelled", "refunded"] },
    paidTotal: { $gt: 0 },
  })
    .sort({ paymentDate: -1, createdAt: -1 })
    .select(
      "invoiceNo paymentType packageName packageDuration packageDurationType periodStart periodEnd paidMonths year subTotal discount billAmount dueAmount paidTotal admissionFee exchange paymentMethod paymentDate status",
    )
    .lean();

  return payments;
};

export const PortalService = {
  memberLogin,
  trainerLogin,
  getTrainerMe,
  getMemberMe,
  getMemberPayments,
};
