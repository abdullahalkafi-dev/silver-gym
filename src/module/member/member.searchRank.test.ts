declare const require: (moduleId: string) => any;

const assert = require("node:assert/strict");
const test = require("node:test").test;

import {
  MEMBER_SEARCH_RANK,
  buildMemberSearchMatch,
  buildMemberOrderStages,
} from "./member.searchRank";

const rankBranches = (term: string) => {
  const stages = buildMemberOrderStages({ searchTerm: term, skip: 0, limit: 20 }) as any[];
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

test("search without a sort orders by relevance first", () => {
  const stages = buildMemberOrderStages({ searchTerm: "003", skip: 0, limit: 20 }) as any[];
  const sort = stages.find((stage) => stage.$sort).$sort;
  assert.deepEqual(Object.keys(sort).slice(0, 2), ["_searchRank", "_memberIdNumber"]);
});

test("member id sort overrides relevance and sorts numerically", () => {
  const asc = buildMemberOrderStages({
    searchTerm: "003",
    memberIdSort: "asc",
    skip: 0,
    limit: 20,
  }) as any[];
  assert.equal(asc[0].$addFields._searchRank, undefined);
  assert.equal(asc.find((stage) => stage.$sort).$sort._memberIdNumber, 1);
  assert.equal(asc[0].$addFields._memberIdNumber.$convert.to, "long");

  const desc = buildMemberOrderStages({ memberIdSort: "desc", skip: 0, limit: 20 }) as any[];
  assert.equal(desc.find((stage) => stage.$sort).$sort._memberIdNumber, -1);
});

test("ids that are not numbers go last in both directions", () => {
  const sentinel = (memberIdSort: "asc" | "desc") =>
    (buildMemberOrderStages({ memberIdSort, skip: 0, limit: 1 }) as any[])[0].$addFields
      ._memberIdNumber.$convert.onError;
  assert.equal(sentinel("asc"), Number.MAX_SAFE_INTEGER);
  assert.equal(sentinel("desc"), -1);
});

test("paging is passed through", () => {
  const stages = buildMemberOrderStages({ memberIdSort: "asc", skip: 200, limit: 100 }) as any[];
  assert.equal(stages.find((stage) => stage.$skip !== undefined).$skip, 200);
  assert.equal(stages.find((stage) => stage.$limit !== undefined).$limit, 100);
});
