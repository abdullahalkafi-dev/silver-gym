/**
 * Data Correction: Fix members affected by admission payment regression
 *
 * This script fixes:
 * 1. carry_forward items that are bug artifacts
 * 2. monthly_due items for months already covered by import
 * 3. nextPaymentDate that was regressed by admission payment
 * 4. currentDueAmount that doesn't match ledger sum
 *
 * Usage:
 *   npx ts-node scripts/fix-admission-payment-corruption.ts          (dry-run)
 *   npx ts-node scripts/fix-admission-payment-corruption.ts --apply  (execute)
 */

import mongoose from "mongoose";
import ConnectDB from "../src/db";
import { Member } from "../src/module/member/member.model";
import { readMemberBillingLedger } from "../src/module/member/member.billingLedger";

const APPLY = process.argv.includes("--apply");

const normalizeMoney = (value: number): number => {
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  return Math.abs(rounded) < 0.005 ? 0 : rounded;
};

interface MemberFix {
  memberId: string;
  memberName: string;
  systemMemberId?: number;
  actions: string[];
  oldNextPaymentDate: Date | null;
  newNextPaymentDate: Date | null;
  oldDueAmount: number;
  newDueAmount: number;
  oldLedgerItems: number;
  newLedgerItems: number;
}

// Members that need fixing (from audit)
const MEMBERS_TO_FIX = [
  // Kafi3 - remove carry_forward + monthly_due Jul (Jul already paid)
  { id: "6a32888c79f55d8a50aa50a4", reason: "carry_forward + monthly_due Jul already paid" },
  // Munim Abdur Noor - remove carry_forward + monthly_due Jul (package starts Aug)
  { id: "6a3434789d8ec6083c3e1fed", reason: "carry_forward + monthly_due Jul before package start" },
  // Kafi444 - remove carry_forward only (keep monthly_due Jul)
  { id: "6a3620d29d8ec6083c3e3758", reason: "carry_forward artifact" },
  // Kafi333 - remove carry_forward only (keep monthly_due Jul)
  { id: "6a361fdf9d8ec6083c3e3756", reason: "carry_forward artifact" },
  // Azizul Hakim Tanvir-2736 - remove both carry_forward (keep monthly_due Jul)
  { id: "6a34347f9d8ec6083c3e3311", reason: "duplicate carry_forward artifacts" },
];

async function runFix() {
  console.log("=".repeat(70));
  console.log("Fix: Admission Payment Corruption");
  console.log(`Mode: ${APPLY ? "APPLY (writing changes)" : "DRY-RUN (no changes)"}`);
  console.log("=".repeat(70));

  await ConnectDB();
  console.log("Connected to MongoDB\n");

  const fixes: MemberFix[] = [];

  for (const memberRef of MEMBERS_TO_FIX) {
    const member = await Member.findById(memberRef.id)
      .select("fullName systemMemberId nextPaymentDate currentDueAmount metadata")
      .lean();

    if (!member) {
      console.log(`SKIP: Member ${memberRef.id} not found`);
      continue;
    }

    const memberId = String(member._id);
    const memberName = member.fullName;
    const systemMemberId = member.systemMemberId;

    const storedNextPaymentDate = member.nextPaymentDate
      ? new Date(member.nextPaymentDate)
      : null;
    const storedCurrentDueAmount = normalizeMoney(member.currentDueAmount ?? 0);

    // Read ledger
    const ledger = readMemberBillingLedger(member);
    const originalItems = [...ledger.items];

    // Identify items to remove
    const carryForwardItems = ledger.items.filter(
      (item) => item.type === "carry_forward" && item.remainingAmount > 0
    );

    const monthlyDueItems = ledger.items.filter(
      (item) =>
        (item.type === "monthly_due" || item.type === "monthly_cycle_due") &&
        item.remainingAmount > 0
    );

    // Determine which items to remove based on member
    const itemsToRemove: string[] = [];

    if (memberRef.id === "6a32888c79f55d8a50aa50a4") {
      // Kafi3: Remove carry_forward + monthly_due Jul (Jul already paid via PAY-000000000040)
      itemsToRemove.push(...carryForwardItems.map((i) => i.key));
      itemsToRemove.push(...monthlyDueItems.map((i) => i.key));
    } else if (memberRef.id === "6a3434789d8ec6083c3e1fed") {
      // Munim Abdur Noor: Remove carry_forward + monthly_due Jul (package starts Aug)
      itemsToRemove.push(...carryForwardItems.map((i) => i.key));
      itemsToRemove.push(...monthlyDueItems.map((i) => i.key));
    } else if (memberRef.id === "6a3620d29d8ec6083c3e3758") {
      // Kafi444: Remove carry_forward only (keep monthly_due Jul)
      itemsToRemove.push(...carryForwardItems.map((i) => i.key));
    } else if (memberRef.id === "6a361fdf9d8ec6083c3e3756") {
      // Kafi333: Remove carry_forward only (keep monthly_due Jul)
      itemsToRemove.push(...carryForwardItems.map((i) => i.key));
    } else if (memberRef.id === "6a34347f9d8ec6083c3e3311") {
      // Azizul Hakim Tanvir-2736: Remove both carry_forward (keep monthly_due Jul)
      itemsToRemove.push(...carryForwardItems.map((i) => i.key));
    }

    // Remove items
    const remainingItems = ledger.items.filter(
      (item) => !itemsToRemove.includes(item.key)
    );

    // Compute new currentDueAmount
    const newCurrentDueAmount = normalizeMoney(
      remainingItems.reduce((sum, item) => sum + item.remainingAmount, 0)
    );

    // Determine new nextPaymentDate
    let newNextPaymentDate = storedNextPaymentDate;

    if (memberRef.id === "6a32888c79f55d8a50aa50a4") {
      // Kafi3: Set to Aug 1 (Jul is paid, next due is Aug)
      newNextPaymentDate = new Date("2026-08-01T00:00:00.000Z");
    } else if (memberRef.id === "6a3434789d8ec6083c3e1fed") {
      // Munim Abdur Noor: Set to Aug 1 (package starts Aug)
      newNextPaymentDate = new Date("2026-08-01T00:00:00.000Z");
    }
    // Others: keep current nextPaymentDate

    // Build actions list
    const actions: string[] = [];
    if (itemsToRemove.length > 0) {
      actions.push(`Remove ${itemsToRemove.length} ledger item(s)`);
    }
    if (newNextPaymentDate && storedNextPaymentDate &&
        newNextPaymentDate.getTime() !== storedNextPaymentDate.getTime()) {
      actions.push(`nextPaymentDate: ${storedNextPaymentDate.toISOString().split("T")[0]} → ${newNextPaymentDate.toISOString().split("T")[0]}`);
    }
    if (normalizeMoney(storedCurrentDueAmount) !== normalizeMoney(newCurrentDueAmount)) {
      actions.push(`currentDueAmount: ${storedCurrentDueAmount} → ${newCurrentDueAmount}`);
    }

    if (actions.length === 0) {
      console.log(`SKIP: ${memberName} — no changes needed`);
      continue;
    }

    const fix: MemberFix = {
      memberId,
      memberName,
      systemMemberId,
      actions,
      oldNextPaymentDate: storedNextPaymentDate,
      newNextPaymentDate,
      oldDueAmount: storedCurrentDueAmount,
      newDueAmount: newCurrentDueAmount,
      oldLedgerItems: originalItems.length,
      newLedgerItems: remainingItems.length,
    };

    fixes.push(fix);

    console.log(`${memberName} (${systemMemberId || memberId})`);
    actions.forEach((a) => console.log(`  - ${a}`));
    console.log("");
  }

  console.log(`\nTotal members to fix: ${fixes.length}`);

  if (fixes.length === 0) {
    console.log("No fixes needed.");
    await mongoose.disconnect();
    return;
  }

  if (!APPLY) {
    console.log("\nDRY-RUN complete. Run with --apply to execute changes.");
    await mongoose.disconnect();
    return;
  }

  // Apply fixes
  console.log("\nApplying fixes...");
  let successCount = 0;
  let errorCount = 0;

  for (const fix of fixes) {
    try {
      const updateOps: Record<string, unknown> = {};

      if (fix.newNextPaymentDate && fix.oldNextPaymentDate &&
          fix.newNextPaymentDate.getTime() !== fix.oldNextPaymentDate.getTime()) {
        updateOps.nextPaymentDate = fix.newNextPaymentDate;
      }

      if (normalizeMoney(fix.oldDueAmount) !== normalizeMoney(fix.newDueAmount)) {
        updateOps.currentDueAmount = fix.newDueAmount;
      }

      // Rebuild ledger items (read current, remove flagged items, write back)
      const member = await Member.findById(fix.memberId).lean();
      if (!member) throw new Error("Member not found");

      const ledger = readMemberBillingLedger(member);
      const itemsToRemove = ledger.items
        .filter((item) => item.type === "carry_forward" && item.remainingAmount > 0)
        .map((i) => i.key);

      // For Kafi3 and Munim, also remove monthly_due items
      if (fix.memberId === "6a32888c79f55d8a50aa50a4" ||
          fix.memberId === "6a3434789d8ec6083c3e1fed") {
        ledger.items
          .filter((item) =>
            (item.type === "monthly_due" || item.type === "monthly_cycle_due") &&
            item.remainingAmount > 0
          )
          .forEach((i) => itemsToRemove.push(i.key));
      }

      const remainingItems = ledger.items.filter(
        (item) => !itemsToRemove.includes(item.key)
      );

      // Compute new due amount from remaining items
      const correctDueAmount = normalizeMoney(
        remainingItems.reduce((sum, item) => sum + item.remainingAmount, 0)
      );

      updateOps.currentDueAmount = correctDueAmount;

      // Update ledger in metadata
      const currentMetadata = (member as any).metadata || {};
      const currentBilling = currentMetadata.billingDueLedger || { version: 1, items: [] };
      const updatedBilling = {
        ...currentBilling,
        items: remainingItems,
        updatedAt: new Date(),
      };

      updateOps.metadata = {
        ...currentMetadata,
        billingDueLedger: updatedBilling,
      };

      await Member.findByIdAndUpdate(fix.memberId, { $set: updateOps });

      console.log(`✅ ${fix.memberName} — fixed`);
      successCount++;
    } catch (error) {
      console.log(`❌ ${fix.memberName} — error: ${error}`);
      errorCount++;
    }
  }

  console.log(`\nDone: ${successCount} fixed, ${errorCount} errors`);

  // Note: Original data is in backup_before_admission_fix_20260702_0835.gz
  console.log("\nNote: Original data preserved in backup_before_admission_fix_20260702_0835.gz");

  await mongoose.disconnect();
}

runFix().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
