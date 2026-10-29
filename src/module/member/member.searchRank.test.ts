declare const require: (moduleId: string) => any;

const assert = require("node:assert/strict");
const test = require("node:test").test;

import {
  MEMBER_SEARCH_RANK,
  buildMemberSearchMatch,
  buildMemberSearchRankStages,
} from "./member.searchRank";

const rankBranches = (term: string) => {
  const stages = buildMemberSearchRankStages(term, { skip: 0, limit: 20 }) as any[];
  return stages[0].$addFields._searchRank.$switch.branches as {
    case: any;
    then: number;
  }[];
};

test("member id exact match ignores leading zeros and ranks first", () => {
  const [first] = rankBranches("003");
  assert.equal(first.then, MEMBER_SEARCH_RANK.idExact);
  assert.equal(first.case.$regexMatch.input, "$memberId");
  const regex = new RegExp(first.case.$regexMatch.regex, "i");
  assert.ok(regex.test("3"));
  assert.ok(regex.test("003"));
  assert.ok(regex.test("0003"));
  assert.ok(!regex.test("0039"));
});

test("ranks member id before phone before name", () => {
  const order = rankBranches("003").map((branch) => branch.then);
  assert.deepEqual(order, [
    MEMBER_SEARCH_RANK.idExact,
    MEMBER_SEARCH_RANK.idStartsWith,
    MEMBER_SEARCH_RANK.idContains,
    MEMBER_SEARCH_RANK.phone,
    MEMBER_SEARCH_RANK.name,
  ]);
});

test("search match also finds the zero-stripped member id", () => {
  const { $or } = buildMemberSearchMatch("003");
  const idClause = $or.find(
    (clause: any) => clause.memberId && clause.memberId.$regex,
  ) as any;
  assert.ok(new RegExp(idClause.memberId.$regex, "i").test("3"));
});

test("regex characters in the search term are escaped", () => {
  const branches = rankBranches("a.b(");
  const contains = branches.find((b) => b.then === MEMBER_SEARCH_RANK.idContains)!;
  assert.equal(contains.case.$regexMatch.regex, "a\\.b\\(");
});
