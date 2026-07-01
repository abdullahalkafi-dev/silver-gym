/**
 * Migration: Fix advanced nextPaymentDate values
 *
 * After 1 month of production use, many members had their nextPaymentDate
 * silently advanced by reconcileMemberRecord and reconcileBranchMemberBilling.
 * This script fixes:
 *   1. nextPaymentDate that was advanced beyond the actual unpaid months
 *   2. currentDueAmount that was double-counted
 *
 * Usage:
 *   npx ts-node scripts/fix-advanced-next-payment-dates.ts          (dry-run, no writes)
 *   npx ts-node scripts/fix-advanced-next-payment-dates.ts --apply  (execute writes)
 */

import mongoose from "mongoose";
import ConnectDB from "../src/db";
import { Member } from "../src/module/member/member.model";
import { readMemberBillingLedger, BILLING_LEDGER_METADATA_KEY } from "../src/module/member/member.billingLedger";

const APPLY = process.argv.includes("--apply");

const normalizeMoney = (value: number): number => {
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  return Math.abs(rounded) < 0.005 ? 0 : rounded;
};

interface MigrationChange {
  memberId: string;
  memberName: string;
  systemMemberId?: number;
  oldNextPaymentDate: Date | null;
  newNextPaymentDate: Date | null;
  oldCurrentDueAmount: number;
  newCurrentDueAmount: number;
  reason: string[];
  hasStaleCarryForward: boolean;
}

async function runMigration() {
  console.log("=".repeat(70));
  console.log("Migration: Fix advanced nextPaymentDate values");
  console.log(`Mode: ${APPLY ? "APPLY (writing changes)" : "DRY-RUN (no changes)"}`);
  console.log("=".repeat(70));

  await ConnectDB();
  console.log("Connected to MongoDB\n");

  const changes: MigrationChange[] = [];
  let processedCount = 0;
  let skippedCount = 0;

  const activeMembers = await Member.find({
    isActive: true,
  })
    .select("fullName memberId systemMemberId nextPaymentDate currentDueAmount metadata")
    .lean();

  console.log(`Found ${activeMembers.length} active members\n`);

  for (const member of activeMembers) {
    processedCount++;
    const memberId = String(member._id);
    const memberName = member.fullName;
    const systemMemberId = member.systemMemberId;

    const storedNextPaymentDate = member.nextPaymentDate
      ? new Date(member.nextPaymentDate)
      : null;
    const storedCurrentDueAmount = normalizeMoney(member.currentDueAmount ?? 0);

    // Read ledger
    const ledger = readMemberBillingLedger(member);

    // Find earliest unpaid monthly_due item
    const unpaidMonthlyItems = ledger.items.filter(
      (item) =>
        (item.type === "monthly_due" || item.type === "monthly_cycle_due") &&
        item.remainingAmount > 0 &&
        item.periodStart
    );

    // Find carry_forward items (potential duplicates from double-counting)
    const carryForwardItems = ledger.items.filter(
      (item) => item.type === "carry_forward" && item.remainingAmount > 0
    );

    // Compute correct currentDueAmount:
    // - If there are monthly_due items, use their sum (carry_forward is likely a duplicate)
    // - If only carry_forward items, use the full ledger sum (legitimate legacy debt)
    let correctCurrentDueAmount: number;
    if (unpaidMonthlyItems.length > 0) {
      correctCurrentDueAmount = normalizeMoney(
        unpaidMonthlyItems.reduce((sum, item) => sum + item.remainingAmount, 0)
      );
    } else {
      correctCurrentDueAmount = normalizeMoney(
        ledger.items.reduce((sum, item) => sum + item.remainingAmount, 0)
      );
    }

    let correctNextPaymentDate: Date | null = null;

    if (unpaidMonthlyItems.length > 0) {
      // Sort by periodStart to find earliest
      const sorted = [...unpaidMonthlyItems].sort((a, b) =>
        (a.periodStart || "").localeCompare(b.periodStart || "")
      );
      const firstItem = sorted[0];
      if (firstItem) {
        const earliestPeriodStart = new Date(firstItem.periodStart || firstItem.createdAt);
        correctNextPaymentDate = earliestPeriodStart;
      }
    } else if (storedNextPaymentDate) {
      // No monthly due items — keep current nextPaymentDate
      correctNextPaymentDate = new Date(storedNextPaymentDate);
    }

    // Determine if nextPaymentDate needs fixing
    let nextPaymentDateNeedsFix = false;
    if (correctNextPaymentDate && storedNextPaymentDate) {
      if (correctNextPaymentDate.getTime() < storedNextPaymentDate.getTime()) {
        nextPaymentDateNeedsFix = true;
      }
    } else if (correctNextPaymentDate && !storedNextPaymentDate) {
      nextPaymentDateNeedsFix = true;
    }

    // Determine if currentDueAmount needs fixing
    const dueAmountNeedsFix =
      normalizeMoney(storedCurrentDueAmount) !== normalizeMoney(correctCurrentDueAmount);

    // Determine if there are stale carry_forward items to remove
    const hasStaleCarryForward =
      unpaidMonthlyItems.length > 0 && carryForwardItems.length > 0;

    if (!nextPaymentDateNeedsFix && !dueAmountNeedsFix && !hasStaleCarryForward) {
      skippedCount++;
      continue;
    }

    const change: MigrationChange = {
      memberId,
      memberName,
      systemMemberId,
      oldNextPaymentDate: storedNextPaymentDate,
      newNextPaymentDate: nextPaymentDateNeedsFix ? correctNextPaymentDate : storedNextPaymentDate,
      oldCurrentDueAmount: storedCurrentDueAmount,
      newCurrentDueAmount: dueAmountNeedsFix ? correctCurrentDueAmount : storedCurrentDueAmount,
      reason: [],
      hasStaleCarryForward,
    };

    if (nextPaymentDateNeedsFix) {
      change.reason.push(
        `nextPaymentDate: ${storedNextPaymentDate?.toISOString().split("T")[0] || "null"} → ${correctNextPaymentDate?.toISOString().split("T")[0] || "null"}`
      );
    }

    if (dueAmountNeedsFix) {
      change.reason.push(
        `currentDueAmount: ${storedCurrentDueAmount} → ${correctCurrentDueAmount}`
      );
    }

    if (hasStaleCarryForward) {
      change.reason.push(
        `removing ${carryForwardItems.length} stale carry_forward item(s) (duplicate of monthly dues)`
      );
    }

    changes.push(change);
  }

  console.log(`\nProcessed: ${processedCount} members`);
  console.log(`Skipped (no change needed): ${skippedCount} members`);
  console.log(`Changes needed: ${changes.length} members\n`);

  if (changes.length === 0) {
    console.log("No changes needed. All members have correct data.");
    await mongoose.disconnect();
    return;
  }

  // Print changes
  console.log("-".repeat(70));
  console.log("CHANGES:");
  console.log("-".repeat(70));

  for (const change of changes) {
    console.log(`\n  Member: ${change.memberName} (${change.memberId})`);
    if (change.systemMemberId) {
      console.log(`  System ID: ${change.systemMemberId}`);
    }
    for (const reason of change.reason) {
      console.log(`    ${reason}`);
    }
  }

  console.log("\n" + "-".repeat(70));

  // Backup and apply if --apply
  if (APPLY) {
    console.log("\nBacking up affected members...");

    const backupCollection = mongoose.connection.db!.collection("migration_backup_next_payment");
    const memberIds = changes.map((c) => new mongoose.Types.ObjectId(c.memberId));
    const backupDocs = await Member.find({ _id: { $in: memberIds } }).lean();

    if (backupDocs.length > 0) {
      await backupCollection.insertMany(
        backupDocs.map((doc) => ({ ...doc, _backupCreatedAt: new Date() }))
      );
      console.log(`Backed up ${backupDocs.length} members to migration_backup_next_payment`);
    }

    console.log("\nApplying changes...");

    let appliedCount = 0;
    for (const change of changes) {
      const update: Record<string, unknown> = {};

      if (change.newNextPaymentDate) {
        update.nextPaymentDate = change.newNextPaymentDate;
      }

      update.currentDueAmount = change.newCurrentDueAmount;

      // If there are stale carry_forward items, remove them from the ledger
      if (change.hasStaleCarryForward) {
        const memberDoc = await Member.findOne({
          _id: new mongoose.Types.ObjectId(change.memberId),
        }).lean();

        if (memberDoc) {
          const ledger = readMemberBillingLedger(memberDoc);
          const cleanedItems = ledger.items.filter(
            (item) => item.type !== "carry_forward"
          );
          const cleanedLedger = {
            version: 1 as const,
            items: cleanedItems,
            updatedAt: new Date().toISOString(),
          };
          const currentMetadata = (memberDoc as unknown as Record<string, unknown>).metadata;
          const metadataObj =
            typeof currentMetadata === "object" && currentMetadata !== null
              ? { ...(currentMetadata as Record<string, unknown>) }
              : {};
          metadataObj[BILLING_LEDGER_METADATA_KEY] = cleanedLedger;
          update.metadata = metadataObj;
        }
      }

      await Member.updateOne(
        { _id: new mongoose.Types.ObjectId(change.memberId) },
        { $set: update }
      );

      appliedCount++;
    }

    console.log(`\nApplied ${appliedCount} changes.`);
  } else {
    console.log("\nDRY-RUN complete. No changes were written.");
    console.log("To apply changes, run: npx ts-node scripts/fix-advanced-next-payment-dates.ts --apply");
  }

  await mongoose.disconnect();
  console.log("\nDone.");
}

runMigration().catch((error) => {
  console.error("Migration failed:", error);
  mongoose.disconnect();
  process.exit(1);
});
