// Parses the "Next payment date" cell of a member import file.
//
// Rule of thumb: a wrong date silently creates wrong dues, while a rejected
// date is shown to the user with its row number. So every input either has
// exactly one sensible reading, or it is rejected with a clear reason.

export type TImportDateParseResult =
  | {
      ok: true;
      date: Date;
      year: number;
      /** 0-based month, like Date#getMonth() */
      month: number;
      day: number;
      /** true when a misspelt month name was corrected (e.g. "Dcember") */
      corrected: boolean;
    }
  | { ok: false; empty: boolean; reason: string };

export type TImportDateParseOptions = {
  /** Reference date for the accepted year window. Defaults to now. */
  now?: Date;
};

const FULL_MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

const MONTH_ALIASES: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};

// Years outside this window around today are almost always typos.
const YEARS_BACK = 10;
const YEARS_AHEAD = 4;

type TMonthMatch = { month: number; corrected: boolean } | { error: string };

// Optimal string alignment distance (Levenshtein + adjacent transposition),
// so "feburary" is one edit away from "february".
const editDistance = (a: string, b: string): number => {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));

  for (let i = 0; i < rows; i += 1) d[i]![0] = i;
  for (let j = 0; j < cols; j += 1) d[0]![j] = j;

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(
        d[i - 1]![j]! + 1,
        d[i]![j - 1]! + 1,
        d[i - 1]![j - 1]! + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, d[i - 2]![j - 2]! + 1);
      }
      d[i]![j] = best;
    }
  }

  return d[rows - 1]![cols - 1]!;
};

const resolveMonth = (rawWord: string): TMonthMatch => {
  const word = rawWord.toLowerCase();

  const fullIndex = FULL_MONTHS.indexOf(word);
  if (fullIndex >= 0) return { month: fullIndex, corrected: false };

  const alias = MONTH_ALIASES[word];
  if (alias !== undefined) return { month: alias, corrected: false };

  // Shortened forms like "septem", "febr", "octo": an unambiguous prefix of
  // one month name, at least 3 letters long.
  if (word.length >= 3) {
    const prefixMatches = FULL_MONTHS
      .map((name, index) => (name.startsWith(word) ? index : -1))
      .filter((index) => index >= 0);
    if (prefixMatches.length === 1) return { month: prefixMatches[0]!, corrected: false };
  }

  // Misspellings: only words of 4+ letters, same first letter, close to exactly
  // one month and clearly further from every other month.
  if (word.length < 4) {
    return { error: `"${rawWord}" is not a month name` };
  }

  const allowed = word.length >= 6 ? 2 : 1;
  const scored = FULL_MONTHS
    .map((name, index) => ({ index, distance: editDistance(word, name), sameStart: name[0] === word[0] }))
    .sort((left, right) => left.distance - right.distance);

  const best = scored[0]!;
  const runnerUp = scored[1]!;

  if (best.distance > allowed || !best.sameStart) {
    return { error: `"${rawWord}" is not a month name` };
  }
  if (runnerUp.distance - best.distance < 2) {
    return {
      error: `"${rawWord}" could be ${capitalize(FULL_MONTHS[best.index]!)} or ${capitalize(FULL_MONTHS[runnerUp.index]!)}`,
    };
  }

  return { month: best.index, corrected: true };
};

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

const toFullYear = (digits: string): number => {
  const value = Number(digits);
  // The client confirmed 2-digit numbers after a month are years: "July 26" = July 2026.
  return digits.length === 2 ? 2000 + value : value;
};

const fail = (reason: string): TImportDateParseResult => ({ ok: false, empty: false, reason });

const build = (
  year: number,
  month: number,
  day: number,
  corrected: boolean,
  original: string,
  now: Date,
): TImportDateParseResult => {
  const minYear = now.getFullYear() - YEARS_BACK;
  const maxYear = now.getFullYear() + YEARS_AHEAD;

  if (year < minYear || year > maxYear) {
    return fail(`year ${year} in "${original}" looks wrong (expected ${minYear}-${maxYear})`);
  }
  if (month < 0 || month > 11) {
    return fail(`"${original}" has no valid month`);
  }

  const date = new Date(year, month, day);
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) {
    return fail(`"${original}" is not a real date`);
  }

  return { ok: true, date, year, month, day, corrected };
};

const withMonth = (
  word: string,
  year: number,
  day: number,
  original: string,
  now: Date,
): TImportDateParseResult => {
  const match = resolveMonth(word);
  if ("error" in match) return fail(match.error);
  return build(year, match.month, day, match.corrected, original, now);
};

// Excel serial day numbers (days since 1899-12-30) for 2000-01-01 .. 2099-12-31.
const EXCEL_SERIAL_MIN = 36526;
const EXCEL_SERIAL_MAX = 73050;

export const parseImportNextPaymentDate = (
  value: unknown,
  options: TImportDateParseOptions = {},
): TImportDateParseResult => {
  const now = options.now ?? new Date();

  if (value == null) return { ok: false, empty: true, reason: "Next payment date is empty" };

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return fail("Next payment date is not a valid date");
    return build(value.getFullYear(), value.getMonth(), value.getDate(), false, value.toISOString(), now);
  }

  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < EXCEL_SERIAL_MIN || value > EXCEL_SERIAL_MAX) {
      return fail(`"${value}" is not a date`);
    }
    const utc = new Date(Date.UTC(1899, 11, 30) + value * 86_400_000);
    return build(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate(), false, String(value), now);
  }

  const original = String(value).trim();
  if (!original) return { ok: false, empty: true, reason: "Next payment date is empty" };

  const text = original
    .toLowerCase()
    // A zero typed instead of the letter O: "0CT 26" -> "oct 26"
    .replace(/(^|[^0-9])0(?=[a-z]{2})/g, "$1o")
    .replace(/\s+/g, " ")
    .trim();

  let m: RegExpMatchArray | null;

  // 2026-11-15, 2026/11/15
  if ((m = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) {
    return build(Number(m[1]), Number(m[2]) - 1, Number(m[3]), false, original, now);
  }

  // 2026-11, 2026/11
  if ((m = text.match(/^(\d{4})[-/.](\d{1,2})$/))) {
    return build(Number(m[1]), Number(m[2]) - 1, 1, false, original, now);
  }

  // 11/2026, 11-2026
  if ((m = text.match(/^(\d{1,2})[-/.](\d{4})$/))) {
    return build(Number(m[2]), Number(m[1]) - 1, 1, false, original, now);
  }

  // 15/11/2026 or 11/15/2026: accepted only when just one reading is possible.
  if ((m = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/))) {
    const first = Number(m[1]);
    const second = Number(m[2]);
    const year = toFullYear(m[3]!);
    if (first === second) return build(year, first - 1, first, false, original, now);
    if (first > 12 && second <= 12) return build(year, second - 1, first, false, original, now);
    if (second > 12 && first <= 12) return build(year, first - 1, second, false, original, now);
    return fail(`"${original}": day and month are unclear, write it like 15-Nov-2026`);
  }

  // 15-Nov-2026, 15 November 26, 1st Dec 2026
  if ((m = text.match(/^(\d{1,2})(?:st|nd|rd|th)?[ ,./-]*([a-z]+)[ ,./-]*(\d{2}|\d{4})$/))) {
    return withMonth(m[2]!, toFullYear(m[3]!), Number(m[1]), original, now);
  }

  // November 15, 2026 (4-digit year only, so "Nov 15" is never mistaken for a year)
  if ((m = text.match(/^([a-z]+)[ ./-]*(\d{1,2})(?:st|nd|rd|th)?[ ,./-]+(\d{4})$/))) {
    return withMonth(m[1]!, Number(m[3]), Number(m[2]), original, now);
  }

  // November-2026, Nov 26, Nov26, Dec - 26, August- 2027
  if ((m = text.match(/^([a-z]+)[ ,.'/-]*(\d{2}|\d{4})$/))) {
    return withMonth(m[1]!, toFullYear(m[2]!), 1, original, now);
  }

  // 2026 November
  if ((m = text.match(/^(\d{4})[ ,./-]*([a-z]+)$/))) {
    return withMonth(m[2]!, Number(m[1]), 1, original, now);
  }

  // "JAN" on its own
  if (/^[a-z]+$/.test(text)) {
    const match = resolveMonth(text);
    if (!("error" in match)) return fail(`"${original}" has a month but no year`);
  }

  return fail(`"${original}" is not a readable date, write it like Nov-2026 or 15-Nov-2026`);
};
