/**
 * Data Correction: Fix carry_forward artifacts + initialize undefined ledgers
 *
 * This script fixes:
 * 1. Kafi555 - carry_forward + wrong admission_due
 * 2. 4 South Banasree members - carry_forward artifacts
 * 3. 264 members with undefined billingDueLedger - initialize empty ledger
 *
 * Usage:
 *   npx ts-node scripts/fix-billing-data-v2.ts          (dry-run)
 *   npx ts-node scripts/fix-billing-data-v2.ts --apply  (execute)
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

// Members with carry_forward that needs removal
const CARRY_FORWARD_FIXES = [
  // Kafi555 - carry_forward ₦1,000 artifact, admission_due should be ₦1,000 not ₦2,000
  {
    id: "6a3620ee9d8ec6083c3e375a",
    name: "Abdullah Al Kafi555",
    removeCarryForward: true,
    fixAdmissionDue: { from: 2000, to: 1000 },
  },
  // 4 South Banasree members - carry_forward ₦2,000 artifacts
  {
    id: null, // Will be found by name
    name: "Jahid Hasan-3242",
    removeCarryForward: true,
  },
  {
    id: null,
    name: "Nadim Hossain-3243",
    removeCarryForward: true,
  },
  {
    id: null,
    name: "Ohidul Islam-3244",
    removeCarryForward: true,
  },
  {
    id: null,
    name: "Fatema Akter Sheuly-3245",
    removeCarryForward: true,
  },
];

async function runFix() {
  console.log("=".repeat(70));
  console.log("Fix: Billing Data Correction v2");
  console.log(`Mode: ${APPLY ? "APPLY (writing changes)" : "DRY-RUN (no changes)"}`);
  console.log("=".repeat(70));

  await ConnectDB();
  console.log("Connected to MongoDB\n");

  let fixCount = 0;
  let errorCount = 0;
  let initCount = 0;

  // === PART 1: Fix carry_forward artifacts ===
  console.log("=== PART 1: Fix carry_forward artifacts ===\n");

  for (const fix of CARRY_FORWARD_FIXES) {
    try {
      // Find member by ID or name
      let member;
      if (fix.id) {
        member = await Member.findById(fix.id).lean();
      } else {
        member = await Member.findOne({ fullName: fix.name }).lean();
      }

      if (!member) {
        console.log(`SKIP: ${fix.name} — not found`);
        continue;
      }

      const memberId = String(member._id);
      const ledger = readMemberBillingLedger(member);
      const originalItems = [...ledger.items];

      // Find carry_forward items to remove
      const carryForwardKeys = ledger.items
        .filter((item) => item.type === "carry_forward" && item.remainingAmount > 0)
        .map((item) => item.key);

      // Filter out carry_forward items
      const remainingItems = ledger.items.filter(
        (item) => !carryForwardKeys.includes(item.key)
      );

      // Fix admission_due if needed
      if (fix.fixAdmissionDue) {
        for (const item of remainingItems) {
          if (item.type === "admission_due" && item.remainingAmount === fix.fixAdmissionDue.from) {
            item.remainingAmount = fix.fixAdmissionDue.to;
            item.originalAmount = fix.fixAdmissionDue.to;
          }
        }
      }

      // Compute new currentDueAmount
      const newDueAmount = normalizeMoney(
        remainingItems.reduce((sum, item) => sum + item.remainingAmount, 0)
      );

      const actions: string[] = [];
      if (carryForwardKeys.length > 0) {
        actions.push(`Remove ${carryForwardKeys.length} carry_forward item(s)`);
      }
      if (fix.fixAdmissionDue) {
        actions.push(`Fix admission_due: ${fix.fixAdmissionDue.from} → ${fix.fixAdmissionDue.to}`);
      }
      if (normalizeMoney(member.currentDueAmount ?? 0) !== newDueAmount) {
        actions.push(`currentDueAmount: ${member.currentDueAmount} → ${newDueAmount}`);
      }

      if (actions.length === 0) {
        console.log(`SKIP: ${fix.name} — no changes needed`);
        continue;
      }

      console.log(`${fix.name} (${(member as any).systemMemberId || memberId})`);
      actions.forEach((a) => console.log(`  - ${a}`));

      if (APPLY) {
        const currentMetadata = (member as any).metadata || {};
        const currentBilling = currentMetadata.billingDueLedger || { version: 1, items: [] };
        const updatedBilling = {
          ...currentBilling,
          items: remainingItems,
          updatedAt: new Date(),
        };

        await Member.findByIdAndUpdate(memberId, {
          $set: {
            currentDueAmount: newDueAmount,
            metadata: {
              ...currentMetadata,
              billingDueLedger: updatedBilling,
            },
          },
        });
        console.log(`  ✅ Applied`);
      }

      fixCount++;
    } catch (error) {
      console.log(`❌ ${fix.name} — error: ${error}`);
      errorCount++;
    }
  }

  // === PART 2: Initialize undefined ledgers ===
  console.log("\n=== PART 2: Initialize undefined ledgers ===\n");

  const undefinedLedgerMembers = await Member.find({
    isActive: true,
    "metadata.billingDueLedger": { $exists: false },
  })
    .select("fullName systemMemberId currentDueAmount metadata")
    .lean();

  console.log(`Found ${undefinedLedgerMembers.length} members with undefined ledger`);

  if (APPLY) {
    for (const member of undefinedLedgerMembers) {
      try {
        const memberId = String(member._id);
        const currentMetadata = (member as any).metadata || {};

        await Member.findByIdAndUpdate(memberId, {
          $set: {
            metadata: {
              ...currentMetadata,
              billingDueLedger: {
                version: 1,
                items: [],
                updatedAt: new Date(),
              },
            },
          },
        });
        initCount++;
      } catch (error) {
        console.log(`❌ ${member.fullName} — error: ${error}`);
        errorCount++;
      }
    }
    console.log(`✅ Initialized ${initCount} ledgers`);
  } else {
    console.log(`DRY-RUN: Would initialize ${undefinedLedgerMembers.length} ledgers`);
  }

  // === Summary ===
  console.log("\n" + "=".repeat(70));
  console.log("Summary:");
  console.log(`  Carry forward fixes: ${fixCount}`);
  console.log(`  Ledger initializations: ${initCount}`);
  console.log(`  Errors: ${errorCount}`);

  if (!APPLY) {
    console.log("\nDRY-RUN complete. Run with --apply to execute changes.");
  }

  await mongoose.disconnect();
}

runFix().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});
