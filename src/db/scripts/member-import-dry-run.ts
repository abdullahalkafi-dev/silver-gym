/**
 * Dry run for a member import CSV. Reads the file only; never connects to the
 * database. Uses the same date and phone rules as the real importer and prints
 * every row the importer would reject, correct, or import without a phone.
 *
 * Usage:
 *   npx tsx src/db/scripts/member-import-dry-run.ts "<path to file.csv>"
 */

import fs from "fs";

import { parseImportNextPaymentDate } from "../../module/member/memberImport.dateParser";
import { normalizeBangladeshPhone } from "../../utils/bangladeshPhone";

const normalizeKey = (value: string) =>
  value.replace(/^﻿/, "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

const parseCsv = (content: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];
    if (inQuotes) {
      if (char === '"' && content[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
};

const pick = (record: Record<string, string>, keys: string[]) => {
  for (const key of keys) {
    const value = record[key]?.trim();
    if (value) return value;
  }
  return undefined;
};

const run = () => {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: npx tsx src/db/scripts/member-import-dry-run.ts "<file.csv>"');
    process.exit(1);
  }

  const [header = [], ...dataRows] = parseCsv(fs.readFileSync(file, "utf8"));
  const keys = header.map(normalizeKey);

  const rejected: string[] = [];
  const corrected: string[] = [];
  const phoneDropped: string[] = [];
  let ok = 0;
  let active = 0;

  dataRows.forEach((cells, index) => {
    if (!cells.some((cell) => cell.trim())) return;

    const record: Record<string, string> = {};
    keys.forEach((key, i) => {
      if (key && record[key] === undefined) record[key] = cells[i] ?? "";
    });

    const sheetRow = index + 2;
    const memberId = pick(record, ["member_id", "memberid"]) ?? "";
    const name = pick(record, ["full_name", "fullname", "name", "member_name"]);
    const phone = pick(record, ["contact", "phone", "mobile", "phone_number"]);
    const status = pick(record, ["status", "member_status"]);
    const isActive = status?.toLowerCase() !== "inactive";
    const label = `row ${sheetRow} | ID ${memberId} | ${name ?? "(no name)"}`;
    if (isActive) active += 1;

    if (!name) {
      rejected.push(`${label} | name is required`);
      return;
    }

    if (phone && !normalizeBangladeshPhone(phone)) {
      phoneDropped.push(`${label} | "${phone}"`);
    }

    const rawDate = pick(record, ["next_payment_date", "next_payment", "nextpaymentdate", "payment_date"]);
    const date = parseImportNextPaymentDate(rawDate);
    if (!date.ok) {
      if (isActive) {
        rejected.push(`${label} | ${date.empty ? "active member has no next payment date" : date.reason}`);
        return;
      }
    } else if (date.corrected) {
      corrected.push(`${label} | "${rawDate}" read as ${date.date.toDateString()}`);
    }

    ok += 1;
  });

  console.log(`Rows: ${ok + rejected.length} (active ${active})`);
  console.log(`Would import: ${ok}`);
  console.log(`\nREJECTED (${rejected.length}) - the whole import stops until these are fixed`);
  rejected.forEach((line) => console.log(`  ${line}`));
  console.log(`\nDATE SPELLING CORRECTED (${corrected.length})`);
  corrected.forEach((line) => console.log(`  ${line}`));
  console.log(`\nIMPORTED WITHOUT PHONE - invalid number (${phoneDropped.length})`);
  phoneDropped.forEach((line) => console.log(`  ${line}`));
};

run();
