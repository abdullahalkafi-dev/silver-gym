/**
 * One-time migration: Fix broken partial payments created by the cleanup loop bug.
 *
 * The bug: updateCollectBillDueLedger pushed unresolved monthly_cycle_due items
 * then immediately zeroed them out with the cycle-period cleanup loop.
 * This caused getMemberDuePayments to zero out the payment's dueAmount too.
 *
 * What this script does:
 * 1. Find payments where invoiceLineItems have unresolvedAmount > 0 but dueAmount = 0
 * 2. Recompute dueAmount and status on those payments
 * 3. Rebuild affected members' billing ledger (add missing monthly_cycle_due items)
 * 4. Recalculate currentDueAmount from the rebuilt ledger
 *
 * Run: npx ts-node scripts/fix-partial-payments.ts
 * Dry-run (default): just prints what would change
 * Apply: npx ts-node scripts/fix-partial-payments.ts --apply
 */

import mongoose from "mongoose";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const DATABASE_URL =
  process.env.DATABASE_URL || "mongodb://127.0.0.1:27017/silvergymdb";

const APPLY = process.argv.includes("--apply");

const BILLING_LEDGER_KEY = "billingDueLedger";

interface LedgerItem {
  key: string;
  type: string;
  label: string;
  originalAmount: number;
  remainingAmount: number;
  dueDate?: string;
  periodStart?: string;
  periodEnd?: string;
  packageId?: string;
  createdAt: string;
}

interface Ledger {
  version: number;
  items: LedgerItem[];
  updatedAt: string;
}

interface InvoiceLineItem {
  key: string;
  kind: string;
  lineType?: string;
  label: string;
  amount: number;
  unresolvedAmount?: number;
  periodStart?: string;
  periodEnd?: string;
  packageId?: string;
}

interface PaymentDoc {
  _id: mongoose.Types.ObjectId;
  memberId?: mongoose.Types.ObjectId;
  subTotal?: number;
  discount?: number;
  paidTotal?: number;
  dueAmount?: number;
  status?: string;
  metadata?: Record<string, unknown>;
}

interface MemberDoc {
  _id: mongoose.Types.ObjectId;
  fullName: string;
  currentDueAmount?: number;
  metadata?: Record<string, unknown>;
}

function computePaymentStatus(
  dueAmount: number,
  paidTotal: number,
): string {
  if (dueAmount <= 0) return "paid";
  if (paidTotal <= 0) return "due";
  return "partial";
}

function normalizeMoney(value: number): number {
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  return Math.abs(rounded) < 0.005 ? 0 : rounded;
}

function sumLedgerItems(items: LedgerItem[]): number {
  return normalizeMoney(
    items.reduce((sum, item) => sum + normalizeMoney(item.remainingAmount), 0),
  );
}

async function run() {
  console.log("Connecting to MongoDB...");
  await mongoose.connect(DATABASE_URL);
  console.log("Connected.\n");

  if (!APPLY) {
    console.log("=== DRY RUN (no changes will be made) ===");
    console.log("Run with --apply to write changes.\n");
  }

  const db = mongoose.connection.db!;
  const paymentsCol = db.collection("payments");
  const membersCol = db.collection("members");

  // Step 1: Find broken payments
  // These are payments where:
  // - metadata.invoiceLineItems has at least one item with unresolvedAmount > 0
  // - dueAmount is 0 or missing
  // - status is "paid"
  // - entryKind is "collect_bill"
  const brokenPayments = await paymentsCol
    .find({
      "metadata.entryKind": "collect_bill",
      "metadata.invoiceLineItems": {
        $elemMatch: { unresolvedAmount: { $gt: 0 } },
      },
      dueAmount: { $in: [0, null] },
      status: "paid",
    })
    .toArray();

  console.log(`Found ${brokenPayments.length} broken payment(s).\n`);

  if (brokenPayments.length === 0) {
    console.log("Nothing to fix.");
    await mongoose.disconnect();
    return;
  }

  // Track affected member IDs
  const affectedMemberIds = new Set<string>();
  let paymentsFixed = 0;

  for (const payment of brokenPayments) {
    const p = payment as unknown as PaymentDoc;
    const subTotal = normalizeMoney(p.subTotal ?? 0);
    const discount = normalizeMoney(p.discount ?? 0);
    const paidTotal = normalizeMoney(p.paidTotal ?? 0);
    const correctDueAmount = normalizeMoney(Math.max(0, subTotal - discount - paidTotal));
    const correctStatus = computePaymentStatus(correctDueAmount, paidTotal);

    console.log(
      `  Payment ${p._id}: ` +
        `dueAmount ${p.dueAmount ?? 0} → ${correctDueAmount}, ` +
        `status ${p.status} → ${correctStatus} ` +
        `(subTotal=${subTotal}, paidTotal=${paidTotal})`,
    );

    if (APPLY) {
      await paymentsCol.updateOne(
        { _id: p._id },
        {
          $set: {
            dueAmount: correctDueAmount,
            status: correctStatus,
          },
        },
      );
    }
    paymentsFixed++;

    if (p.memberId) {
      affectedMemberIds.add(String(p.memberId));
    }
  }

  console.log(`\nFixed ${paymentsFixed} payment(s).`);

  // Step 2: Rebuild affected members' billing ledger
  console.log(`\nRebuilding ledger for ${affectedMemberIds.size} affected member(s)...\n`);

  let membersFixed = 0;

  for (const memberIdStr of affectedMemberIds) {
    const memberId = new mongoose.Types.ObjectId(memberIdStr);
    const member = (await membersCol.findOne({
      _id: memberId,
    })) as unknown as MemberDoc | null;

    if (!member) {
      console.log(`  Member ${memberIdStr}: not found, skipping`);
      continue;
    }

    const ledger = (member.metadata?.[BILLING_LEDGER_KEY] as Ledger) || {
      version: 1,
      items: [],
      updatedAt: new Date(0).toISOString(),
    };

    const ledgerItems = [...ledger.items.map((item) => ({ ...item }))];

    // Step 2a: Fix existing ledger items with null periodStart/periodEnd
    // These were created by a migration that stored ISODate objects instead of strings.
    // readMemberBillingLedger expects strings, so ISODate becomes undefined/null.
    for (const item of ledgerItems) {
      if (
        (item.type === "monthly_cycle_due" || item.type === "package_due") &&
        !item.periodStart
      ) {
        // Find the matching payment's invoiceLineItem by matching remainingAmount
        for (const mp of await paymentsCol.find({
          memberId: memberId,
          "metadata.entryKind": "collect_bill",
          "metadata.invoiceLineItems.kind": "cycle",
        }).toArray()) {
          const mpd = mp as unknown as PaymentDoc;
          const invoiceLines = (mpd.metadata?.invoiceLineItems || []) as InvoiceLineItem[];
          for (const line of invoiceLines) {
            if (line.kind !== "cycle") continue;
            const lineUnresolved = normalizeMoney(line.unresolvedAmount ?? 0);
            const lineAmount = normalizeMoney(line.amount ?? 0);
            const linePaid = normalizeMoney(lineAmount - lineUnresolved);
            // Match by originalAmount or remainingAmount
            if (
              normalizeMoney(item.originalAmount) === lineUnresolved &&
              line.periodStart
            ) {
              const ps = typeof line.periodStart === "string"
                ? line.periodStart
                : line.periodStart instanceof Date
                  ? line.periodStart.toISOString()
                  : String(line.periodStart);
              const pe = typeof line.periodEnd === "string"
                ? line.periodEnd
                : line.periodEnd instanceof Date
                  ? line.periodEnd.toISOString()
                  : line.periodEnd ? String(line.periodEnd) : undefined;

              console.log(
                `  ${member.fullName}: fixing periodStart on ${item.key}: null → ${ps}`,
              );
              if (APPLY) {
                item.periodStart = ps;
                item.periodEnd = pe;
              }
              break;
            }
          }
        }
      }
    }

    // Find all payments for this member that have unresolved amounts
    const memberPayments = await paymentsCol
      .find({
        memberId: memberId,
        "metadata.entryKind": "collect_bill",
        "metadata.invoiceLineItems": {
          $elemMatch: { unresolvedAmount: { $gt: 0 } },
        },
      })
      .toArray();

    let itemsAdded = 0;

    for (const mp of memberPayments) {
      const mpd = mp as unknown as PaymentDoc;
      const invoiceLines = (mpd.metadata?.invoiceLineItems || []) as InvoiceLineItem[];

      for (const line of invoiceLines) {
        if (line.kind !== "cycle") continue;
        const unresolved = normalizeMoney(line.unresolvedAmount ?? 0);
        if (unresolved <= 0) continue;

        // Check if a ledger item already exists for this cycle period
        const periodStart = typeof line.periodStart === "string"
          ? line.periodStart
          : line.periodStart instanceof Date
            ? line.periodStart.toISOString()
            : line.periodStart ? String(line.periodStart) : undefined;
        const periodEnd = typeof line.periodEnd === "string"
          ? line.periodEnd
          : line.periodEnd instanceof Date
            ? line.periodEnd.toISOString()
            : line.periodEnd ? String(line.periodEnd) : undefined;
        const existingItem = ledgerItems.find(
          (item) =>
            (item.type === "monthly_cycle_due" || item.type === "package_due") &&
            item.periodStart === periodStart &&
            item.periodEnd === periodEnd,
        );

        if (existingItem) {
          // Item exists — just make sure remainingAmount is correct
          if (normalizeMoney(existingItem.remainingAmount) < unresolved) {
            console.log(
              `  ${member.fullName}: fixing ledger item ${existingItem.key} ` +
                `remainingAmount ${existingItem.remainingAmount} → ${unresolved}`,
            );
            if (APPLY) {
              existingItem.remainingAmount = unresolved;
            }
          }
        } else {
          // Missing ledger item — create it
          const newItemKey = `monthly_cycle_due:${Date.now()}_${itemsAdded}`;
          const newItem: LedgerItem = {
            key: newItemKey,
            type: line.lineType === "package_cycle" ? "package_due" : "monthly_cycle_due",
            label: line.label || "Unresolved cycle charge",
            originalAmount: unresolved,
            remainingAmount: unresolved,
            dueDate: mpd.metadata?.paymentDate
              ? new Date(mpd.metadata.paymentDate as string).toISOString()
              : new Date().toISOString(),
            periodStart: periodStart,
            periodEnd: periodEnd,
            packageId: line.packageId,
            createdAt: new Date().toISOString(),
          };

          console.log(
            `  ${member.fullName}: adding missing ledger item ${newItemKey} ` +
              `(${newItem.type}, remainingAmount=${unresolved})`,
          );

          if (APPLY) {
            ledgerItems.push(newItem);
          }
          itemsAdded++;
        }
      }
    }

    // Recalculate currentDueAmount from ledger
    const newLedgerTotal = sumLedgerItems(ledgerItems);
    const currentDue = normalizeMoney(member.currentDueAmount ?? 0);

    if (itemsAdded > 0 || normalizeMoney(newLedgerTotal - currentDue) !== 0) {
      console.log(
        `  ${member.fullName}: currentDueAmount ${currentDue} → ${newLedgerTotal}` +
          ` (ledger has ${ledgerItems.length} items)`,
      );

      if (APPLY) {
        const updatedLedger: Ledger = {
          version: 1,
          items: ledgerItems,
          updatedAt: new Date().toISOString(),
        };

        await membersCol.updateOne(
          { _id: memberId },
          {
            $set: {
              currentDueAmount: newLedgerTotal,
              [`metadata.${BILLING_LEDGER_KEY}`]: updatedLedger,
            },
          },
        );
      }
      membersFixed++;
    } else {
      console.log(`  ${member.fullName}: OK (no changes needed)`);
    }
  }

  console.log(`\nDone.`);
  console.log(`  Payments fixed: ${paymentsFixed}`);
  console.log(`  Members rebuilt: ${membersFixed}`);

  if (!APPLY) {
    console.log(`\n=== DRY RUN COMPLETE — no changes were written ===`);
    console.log(`Run with --apply to write changes.`);
  }

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
