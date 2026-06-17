/**
 * One-time migration: Remove stale monthly_due / monthly_cycle_due ledger items
 * whose periodEnd is before the member's nextPaymentDate.
 *
 * Run with: npx ts-node scripts/fix-stale-monthly-dues.ts
 *
 * Uses the same DATABASE_URL from the environment or .env file.
 */

import mongoose from "mongoose";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const DATABASE_URL =
  process.env.DATABASE_URL || "mongodb://127.0.0.1:27017/silvergymdb";

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

interface MemberDoc {
  _id: mongoose.Types.ObjectId;
  fullName: string;
  nextPaymentDate?: Date;
  currentDueAmount?: number;
  metadata?: Record<string, unknown>;
}

async function run() {
  console.log("Connecting to MongoDB...");
  await mongoose.connect(DATABASE_URL);
  console.log("Connected.\n");

  const db = mongoose.connection.db!;
  const collection = db.collection("members");

  const STALE_TYPES = new Set(["monthly_due", "monthly_cycle_due"]);

  let scanned = 0;
  let cleaned = 0;
  let totalItemsRemoved = 0;

  const cursor = collection.find({
    "metadata.billingDueLedger.items": { $exists: true, $ne: [] },
  });

  while (await cursor.hasNext()) {
    const doc = (await cursor.next()) as unknown as MemberDoc;
    scanned++;

    const ledger = doc.metadata?.[BILLING_LEDGER_KEY] as Ledger | undefined;
    if (!ledger || !Array.isArray(ledger.items) || ledger.items.length === 0) {
      continue;
    }

    const nextPaymentDate = doc.nextPaymentDate
      ? new Date(doc.nextPaymentDate)
      : null;

    if (!nextPaymentDate) continue;

    const beforeCount = ledger.items.length;
    const cleanedItems = ledger.items.filter((item) => {
      if (!STALE_TYPES.has(item.type)) return true;
      if (!item.periodEnd) return true;
      const periodEnd = new Date(item.periodEnd);
      // Keep the item if its periodEnd is after the member's nextPaymentDate
      return periodEnd > nextPaymentDate;
    });

    const removedCount = beforeCount - cleanedItems.length;
    if (removedCount > 0) {
      cleaned++;
      totalItemsRemoved += removedCount;

      const cleanedLedger: Ledger = {
        ...ledger,
        items: cleanedItems,
        updatedAt: new Date().toISOString(),
      };

      await collection.updateOne(
        { _id: doc._id },
        {
          $set: {
            [`metadata.${BILLING_LEDGER_KEY}`]: cleanedLedger,
          },
        },
      );

      console.log(
        `  [CLEANED] ${doc.fullName} (${doc._id}): removed ${removedCount} stale item(s) ` +
          `(nextPayment: ${nextPaymentDate.toISOString().slice(0, 10)})`,
      );
    }
  }

  console.log(`\nDone.`);
  console.log(`  Scanned: ${scanned} members`);
  console.log(`  Cleaned: ${cleaned} members`);
  console.log(`  Items removed: ${totalItemsRemoved}`);

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
