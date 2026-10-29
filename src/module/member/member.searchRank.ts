import { PipelineStage, Types } from "mongoose";

import { buildMemberIdPattern } from "../access/access.memberId";
import { normalizeMemberId } from "../access/access.policy";

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Lower rank = shown first. Member ID is admin-managed, so it always wins over
 * phone, and phone wins over name.
 */
export const MEMBER_SEARCH_RANK = {
  idExact: 0,
  idStartsWith: 1,
  idContains: 2,
  phone: 3,
  name: 4,
  other: 5,
} as const;

/** Raw `$or` clauses a member must satisfy to appear in the search at all. */
export const buildMemberSearchMatch = (searchTerm: string) => {
  const term = searchTerm.trim();
  const escaped = escapeRegex(term);
  const idKey = normalizeMemberId(term);

  const clauses: Record<string, unknown>[] = [
    // "003", "03" and "3" are the same member ID (the door device ignores leading zeros).
    ...(idKey
      ? [{ memberId: { $regex: buildMemberIdPattern(idKey), $options: "i" } }]
      : []),
    ...["fullName", "email", "contact", "memberId", "barcode"].map((field) => ({
      [field]: new RegExp(escaped, "i"),
    })),
  ];

  if (Types.ObjectId.isValid(term) && String(new Types.ObjectId(term)) === term) {
    clauses.unshift({ _id: new Types.ObjectId(term) });
  }

  return { $or: clauses };
};

const matches = (field: string, pattern: string) => ({
  $regexMatch: { input: `$${field}`, regex: pattern, options: "i" },
});

/** Aggregation stages that order a filtered member list by search relevance. */
export const buildMemberSearchRankStages = (
  searchTerm: string,
  page: { skip: number; limit: number },
): PipelineStage[] => {
  const term = searchTerm.trim();
  const escaped = escapeRegex(term);
  const idKey = normalizeMemberId(term);

  const branches: { case: unknown; then: number }[] = [];

  if (Types.ObjectId.isValid(term) && String(new Types.ObjectId(term)) === term) {
    branches.push({
      case: { $eq: ["$_id", new Types.ObjectId(term)] },
      then: MEMBER_SEARCH_RANK.idExact,
    });
  }

  if (idKey) {
    branches.push({
      case: matches("memberId", buildMemberIdPattern(idKey)),
      then: MEMBER_SEARCH_RANK.idExact,
    });
  }

  branches.push(
    {
      case: matches("memberId", `^\\s*${escaped}`),
      then: MEMBER_SEARCH_RANK.idStartsWith,
    },
    { case: matches("memberId", escaped), then: MEMBER_SEARCH_RANK.idContains },
    { case: matches("contact", escaped), then: MEMBER_SEARCH_RANK.phone },
    { case: matches("fullName", escaped), then: MEMBER_SEARCH_RANK.name },
  );

  return [
    {
      $addFields: {
        _searchRank: { $switch: { branches, default: MEMBER_SEARCH_RANK.other } },
        // Numeric order inside a tier (0030, 0031 ... not 0030, 0300); non-numeric IDs sort last.
        _memberIdNumber: {
          $convert: { input: "$memberId", to: "long", onError: Number.MAX_SAFE_INTEGER, onNull: Number.MAX_SAFE_INTEGER },
        },
      },
    },
    { $sort: { _searchRank: 1, _memberIdNumber: 1, createdAt: -1, _id: 1 } },
    { $skip: page.skip },
    { $limit: page.limit },
    { $project: { _searchRank: 0, _memberIdNumber: 0 } },
  ];
};
