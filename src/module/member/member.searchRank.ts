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

export type TMemberIdSort = "asc" | "desc";

const buildRankBranches = (term: string) => {
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
      case: matches("memberId", `^\s*${escaped}`),
      then: MEMBER_SEARCH_RANK.idStartsWith,
    },
    { case: matches("memberId", escaped), then: MEMBER_SEARCH_RANK.idContains },
    { case: matches("contact", escaped), then: MEMBER_SEARCH_RANK.phone },
    { case: matches("fullName", escaped), then: MEMBER_SEARCH_RANK.name },
  );

  return branches;
};

/**
 * Aggregation stages that order and page a filtered member list.
 *
 * - searchTerm only: relevance order (member ID, then phone, then name).
 * - memberIdSort set: the user clicked the Member ID header, so that order wins
 *   over relevance (the search still decides which members are listed).
 *
 * Member IDs are text, so they are compared as numbers (2 before 10, "003" is 3).
 * IDs that are not numbers always go last, in either direction.
 */
export const buildMemberOrderStages = (options: {
  searchTerm?: string;
  memberIdSort?: TMemberIdSort;
  skip: number;
  limit: number;
}): PipelineStage[] => {
  const term = options.searchTerm?.trim() ?? "";
  const direction = options.memberIdSort === "desc" ? -1 : 1;
  const notNumeric = direction === 1 ? Number.MAX_SAFE_INTEGER : -1;

  const sort: Record<string, 1 | -1> = options.memberIdSort
    ? { _memberIdNumber: direction, memberId: direction, createdAt: -1, _id: 1 }
    : { _searchRank: 1, _memberIdNumber: 1, createdAt: -1, _id: 1 };

  return [
    {
      $addFields: {
        ...(term && !options.memberIdSort
          ? {
              _searchRank: {
                $switch: {
                  branches: buildRankBranches(term),
                  default: MEMBER_SEARCH_RANK.other,
                },
              },
            }
          : {}),
        _memberIdNumber: {
          $convert: {
            input: "$memberId",
            to: "long",
            onError: notNumeric,
            onNull: notNumeric,
          },
        },
      },
    },
    { $sort: sort },
    { $skip: options.skip },
    { $limit: options.limit },
    { $project: { _searchRank: 0, _memberIdNumber: 0 } },
  ];
};
