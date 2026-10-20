import { StatusCodes } from "http-status-codes";
import { Types } from "mongoose";

import AppError from "../../errors/AppError";
import { Member } from "../member/member.model";
import { normalizeMemberId } from "./access.policy";

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Matches the same id with any number of leading zeros and stray spaces. */
export const buildMemberIdPattern = (key: string) =>
  key === "0" ? "^\\s*0+\\s*$" : `^\\s*0*${escapeRegex(key)}\\s*$`;

/** Finds the one member of the branch with this admin-given id (leading zeros ignored). */
export const findMemberByAdminId = async (branchId: string, memberId: string) => {
  const key = normalizeMemberId(memberId);
  if (!key) {
    return null;
  }

  const matches = await Member.find({
    branchId: new Types.ObjectId(branchId),
    memberId: { $regex: buildMemberIdPattern(key), $options: "i" },
  })
    .select("memberId fullName")
    .limit(2)
    .lean();

  return matches.length === 1 ? matches[0]! : null;
};

/**
 * The door device stores "7" while the app may store "007", so two members
 * whose ids only differ by leading zeros would be mixed up at the door.
 * Rejects an id that another member of the same branch already uses.
 */
export const assertMemberIdAvailable = async (
  branchId: string,
  memberId: string | undefined | null,
  excludeMemberId?: string,
) => {
  const key = normalizeMemberId(memberId);
  if (!key) {
    return;
  }

  const clash = await Member.findOne({
    branchId: new Types.ObjectId(branchId),
    memberId: { $regex: buildMemberIdPattern(key), $options: "i" },
    ...(excludeMemberId ? { _id: { $ne: new Types.ObjectId(excludeMemberId) } } : {}),
  })
    .select("memberId fullName")
    .lean();

  if (clash) {
    throw new AppError(
      StatusCodes.CONFLICT,
      `Member ID "${memberId}" is already used by ${clash.fullName} (${clash.memberId}) in this branch. Leading zeros are ignored, so 007 and 7 are the same ID.`,
    );
  }
};
