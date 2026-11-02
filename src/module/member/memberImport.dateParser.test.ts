declare const require: (moduleId: string) => any;

const assert = require("node:assert/strict");
const test = require("node:test").test;

import { parseImportNextPaymentDate } from "./memberImport.dateParser";

// Fixed "today" so the accepted year window (2016-2030) never drifts.
const NOW = new Date(2026, 10, 2);
const parse = (value: unknown) => parseImportNextPaymentDate(value, { now: NOW });

const FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const expectDate = (input: unknown, year: number, month: number, day = 1) => {
  const result = parse(input);
  assert.equal(result.ok, true, `expected ${JSON.stringify(input)} to parse, got ${JSON.stringify(result)}`);
  if (!result.ok) return;
  assert.equal(result.year, year, `year of ${JSON.stringify(input)}`);
  assert.equal(result.month, month, `month of ${JSON.stringify(input)}`);
  assert.equal(result.day, day, `day of ${JSON.stringify(input)}`);
  assert.equal(result.date.getFullYear(), year);
  assert.equal(result.date.getMonth(), month);
  assert.equal(result.date.getDate(), day);
};

const expectReject = (input: unknown) => {
  const result = parse(input);
  assert.equal(result.ok, false, `expected ${JSON.stringify(input)} to be rejected, got ${JSON.stringify(result)}`);
  if (!result.ok) assert.ok(result.reason.length > 0);
};

test("formats the old importer accepted still give the same dates", () => {
  expectDate("01-May-26", 2026, 4, 1);
  expectDate("31-Jan-2026", 2026, 0, 31);
  expectDate("May-26", 2026, 4);
  expectDate("Jan-2026", 2026, 0);
  expectDate("nov-2026", 2026, 10);
});

test("generated matrix: every month, spelling, case, separator and year form", () => {
  const separators = ["-", " ", "/", ".", "", " - ", "- ", " -", ", "];
  let checked = 0;

  for (let month = 0; month < 12; month += 1) {
    const names = new Set([
      FULL[month]!,
      SHORT[month]!,
      FULL[month]!.toUpperCase(),
      FULL[month]!.toLowerCase(),
      SHORT[month]!.toUpperCase(),
      SHORT[month]!.toLowerCase(),
    ]);
    if (month === 8) {
      names.add("Sept");
      names.add("SEPT");
    }

    for (const name of names) {
      for (const sep of separators) {
        for (const year of [2017, 2020, 2025, 2026, 2027, 2030]) {
          expectDate(`${name}${sep}${year}`, year, month);
          expectDate(`${name}${sep}${String(year).slice(2)}`, year, month);
          checked += 2;
        }
      }
    }
  }

  assert.ok(checked > 3000, `matrix too small: ${checked}`);
});

test("generated matrix: day + month + year in every common layout", () => {
  for (let month = 0; month < 12; month += 1) {
    for (const day of [1, 9, 15, 28]) {
      for (const name of [FULL[month]!, SHORT[month]!, SHORT[month]!.toUpperCase()]) {
        expectDate(`${day}-${name}-2026`, 2026, month, day);
        expectDate(`${String(day).padStart(2, "0")}-${name}-26`, 2026, month, day);
        expectDate(`${day} ${name} 2026`, 2026, month, day);
        expectDate(`${name} ${day}, 2026`, 2026, month, day);
      }
    }
  }
});

test("every distinct date value from the client's files", () => {
  const cases: Array<[string, number, number]> = [
    ["0CT 26", 2026, 9],
    ["0ct 26", 2026, 9],
    ["April 26", 2026, 3],
    ["April-2026", 2026, 3],
    ["April-2027", 2027, 3],
    ["Aug 26", 2026, 7],
    ["August- 2027", 2027, 7],
    ["August-2026", 2026, 7],
    ["August-2027", 2027, 7],
    ["Dcember 26", 2026, 11],
    ["Dec - 26", 2026, 11],
    ["Dec 26", 2026, 11],
    ["Dec-2026", 2026, 11],
    ["December-2026", 2026, 11],
    ["FEBURARY 26", 2026, 1],
    ["Feb 26", 2026, 1],
    ["Feb-2027", 2027, 1],
    ["February-2026", 2026, 1],
    ["Jan 2027", 2027, 0],
    ["Jan-2027", 2027, 0],
    ["January-2026", 2026, 0],
    ["January-2027", 2027, 0],
    ["January-27", 2027, 0],
    ["July 26", 2026, 6],
    ["July 27", 2027, 6],
    ["July 28", 2028, 6],
    ["July-2026", 2026, 6],
    ["July-2027", 2027, 6],
    ["July-2028", 2028, 6],
    ["June 27", 2027, 5],
    ["June-2026", 2026, 5],
    ["June-2027", 2027, 5],
    ["March 26", 2026, 2],
    ["March-2026", 2026, 2],
    ["March-2027", 2027, 2],
    ["May-2026", 2026, 4],
    ["May-2027", 2027, 4],
    ["Nov 2026", 2026, 10],
    ["Nov 26", 2026, 10],
    ["Nov-2026", 2026, 10],
    ["Nov26", 2026, 10],
    ["November-2026", 2026, 10],
    ["November-2027", 2027, 10],
    ["OCOTOBER 26", 2026, 9],
    ["Oct 26", 2026, 9],
    ["October-2026", 2026, 9],
    ["October-2027", 2027, 9],
    ["October-27", 2027, 9],
    ["Sep 26", 2026, 8],
    ["Sep-2026", 2026, 8],
    ["September 26", 2026, 8],
    ["September-2026", 2026, 8],
    ["januaery-2026", 2026, 0],
    ["septem26", 2026, 8],
  ];

  for (const [input, year, month] of cases) expectDate(input, year, month);

  // Values from the same files that must NOT become a date.
  expectReject("JAN"); // no year
  expectReject("oc t 26"); // broken month word
  expectReject("AUH 2027"); // not a month
  expectReject("October-31"); // would be the year 2031, outside the window
});

test("misspelt months are corrected and flagged", () => {
  const typos: Array<[string, number]> = [
    ["januaery", 0], ["janury", 0], ["jaunary", 0],
    ["feburary", 1], ["febuary", 1], ["febrary", 1],
    ["marhc", 2],
    ["apirl", 3], ["aprl", 3],
    ["agust", 7], ["augst", 7],
    ["septmber", 8], ["spetember", 8],
    ["ocotober", 9], ["octber", 9], ["otcober", 9],
    ["novmber", 10], ["novembr", 10], ["noveber", 10],
    ["dcember", 11], ["decmber", 11], ["decembr", 11],
  ];

  for (const [word, month] of typos) {
    const result = parse(`${word}-2026`);
    assert.equal(result.ok, true, `${word} should parse`);
    if (!result.ok) continue;
    assert.equal(result.month, month, `${word} should be month ${month}`);
    assert.equal(result.corrected, true, `${word} should be flagged as corrected`);
  }

  const exact = parse("December-2026");
  assert.equal(exact.ok && exact.corrected, false);
});

test("short prefixes are accepted only when they point to one month", () => {
  expectDate("septem 2026", 2026, 8);
  expectDate("febr 2026", 2026, 1);
  expectDate("octo-2026", 2026, 9);
  expectDate("janu 26", 2026, 0);

  expectReject("ju 2026"); // June or July
  expectReject("ma 2026"); // March or May
  expectReject("j 2026");
});

test("ambiguous or doubtful words are rejected instead of guessed", () => {
  expectReject("jume 2026"); // June or July?
  expectReject("juli 2026"); // July or June?
  expectReject("jly 2026"); // too short to correct
  expectReject("setember 2026"); // 1 edit from September but only 2 from December
  expectReject("monthly 2026");
  expectReject("Monthly");
  expectReject("xyz 2026");
});

test("numeric dates are accepted only when the reading is certain", () => {
  expectDate("2026-11-15", 2026, 10, 15);
  expectDate("2026/02/01", 2026, 1, 1);
  expectDate("2026-11", 2026, 10);
  expectDate("11/2026", 2026, 10);
  expectDate("25/06/2026", 2026, 5, 25); // day > 12, so DD/MM
  expectDate("06/25/2026", 2026, 5, 25); // day > 12, so MM/DD
  expectDate("05/05/2026", 2026, 4, 5); // both the same

  expectReject("05/06/2026"); // 5 June or 6 May?
  expectReject("4/1/26"); // 4 Jan or 1 Apr?
  expectReject("13/13/2026");
  expectReject("2026-13-01");
  expectReject("2026");
  expectReject("202611");
  expectReject("13-2026");
});

test("impossible days are rejected", () => {
  expectReject("32-Jan-2026");
  expectReject("29-Feb-2027");
  expectReject("31-Apr-2026");
  expectReject("0-Jan-2026");
  expectDate("29-Feb-2028", 2028, 1, 29);
});

test("years outside the window are rejected", () => {
  expectReject("Nov-2031");
  expectReject("Nov-2015");
  expectReject("Nov-1999");
  expectReject("Nov-99");
  expectReject("Nov-31");
  expectDate("Nov-2030", 2030, 10);
  expectDate("Nov-2016", 2016, 10);
});

test("empty and junk input never becomes a date", () => {
  for (const value of [undefined, null, "", "   ", "\t"]) {
    const result = parse(value);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.empty, true);
  }

  for (const value of ["abc", "N/A", "-", "0", "26", "Nov", "Jan Feb 2026", "Nov-2026-extra", "6 month pakage", "paid"]) {
    expectReject(value);
  }
});

test("real Excel date cells and serial numbers", () => {
  expectDate(new Date(2026, 3, 1), 2026, 3, 1);
  expectDate(46113, 2026, 3, 1); // Excel serial for 2026-04-01
  expectReject(new Date(Number.NaN));
  expectReject(12.5);
  expectReject(5);
});

test("round trip: every month 2016-2030 written in every format parses back", () => {
  for (let year = 2016; year <= 2030; year += 1) {
    for (let month = 0; month < 12; month += 1) {
      const yy = String(year).slice(2);
      const mm = String(month + 1).padStart(2, "0");
      const inputs = [
        `${FULL[month]}-${year}`,
        `${SHORT[month]}-${yy}`,
        `${SHORT[month]} ${year}`,
        `${FULL[month]!.toUpperCase()} ${yy}`,
        `${SHORT[month]}${yy}`,
        `${year}-${mm}`,
        `${mm}/${year}`,
        `${year}-${mm}-15`,
        `15-${SHORT[month]}-${year}`,
      ];
      for (const input of inputs) {
        const day = input.includes("15") ? 15 : 1;
        expectDate(input, year, month, day);
      }
    }
  }
});

test("random text: anything that parses must contain a real month or digits that form a date", () => {
  let seed = 12345;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789 -/.";
  const monthWords = [...FULL, ...SHORT, "sept"].map((m) => m.toLowerCase());

  for (let i = 0; i < 20000; i += 1) {
    const length = 1 + Math.floor(random() * 12);
    let text = "";
    for (let j = 0; j < length; j += 1) text += alphabet[Math.floor(random() * alphabet.length)];

    const result = parse(text);
    if (!result.ok) continue;

    const letters = text.toLowerCase().replace(/[^a-z]/g, "");
    if (letters.length > 0) {
      // Letters must be a month, a month prefix or a close misspelling (flagged).
      const isKnown = monthWords.some((m) => m === letters || m.startsWith(letters));
      assert.ok(
        isKnown || result.corrected || /^(st|nd|rd|th)$/.test(letters),
        `random text ${JSON.stringify(text)} parsed as a date`,
      );
    }
    assert.ok(result.year >= 2016 && result.year <= 2030);
  }
});
