/**
 * Migration: Unify invoice numbers to PAY-XXXXXXXXXXXX / EXP-XXXXXXXXXXXX
 *
 * Rewrites all existing payment and expense invoice numbers to the new format:
 *   Payments → PAY-000000000001, PAY-000000000002, ...
 *   Expenses → EXP-000000000001, EXP-000000000002, ...
 *
 * Then creates/updates the global InvoiceCounter documents.
 *
 * Usage:
 *   npx tsx src/db/migrations/unify-invoice-numbers.ts
 */

import mongoose from "mongoose";
import config from "../../config";

const BATCH_SIZE = 500;

const run = async () => {
  await mongoose.connect(config.database_url as string);
  console.log("Connected to MongoDB");

  const db = mongoose.connection.db;
  if (!db) {
    throw new Error("Database connection is not established");
  }

  const payments = db.collection("payments");
  const expenses = db.collection("expenses");
  const counters = db.collection("invoicecounters");

  // ─── Migrate Payments ──────────────────────────────────────────────────
  console.log("\n--- Migrating Payments ---");
  const allPayments = await payments
    .find({})
    .sort({ createdAt: 1 })
    .project({ _id: 1, invoiceNo: 1 })
    .toArray();

  console.log(`Found ${allPayments.length} payments`);

  if (allPayments.length > 0) {
    // Step 1: Rename all to temporary unique values to avoid conflicts
    const tempOps = allPayments.map((doc, i) => ({
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: { invoiceNo: `TEMP_PAY_${i}_${Date.now()}` } },
      },
    }));
    for (let i = 0; i < tempOps.length; i += BATCH_SIZE) {
      await payments.bulkWrite(tempOps.slice(i, i + BATCH_SIZE));
    }
    console.log("  Step 1: Renamed to temporary values");

    // Step 2: Assign new sequential values
    const newOps = allPayments.map((doc, i) => ({
      updateOne: {
        filter: { _id: doc._id },
        update: {
          $set: { invoiceNo: `PAY-${String(i + 1).padStart(12, "0")}` },
        },
      },
    }));
    for (let i = 0; i < newOps.length; i += BATCH_SIZE) {
      await payments.bulkWrite(newOps.slice(i, i + BATCH_SIZE));
    }
    console.log(`  Step 2: Updated ${allPayments.length} payments (PAY-000000000001 to PAY-${String(allPayments.length).padStart(12, "0")})`);
  }

  // ─── Migrate Expenses ──────────────────────────────────────────────────
  console.log("\n--- Migrating Expenses ---");
  const allExpenses = await expenses
    .find({})
    .sort({ createdAt: 1 })
    .project({ _id: 1, invoiceNo: 1 })
    .toArray();

  console.log(`Found ${allExpenses.length} expenses`);

  if (allExpenses.length > 0) {
    // Step 1: Rename all to temporary unique values to avoid unique index conflicts
    const tempOps = allExpenses.map((doc, i) => ({
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: { invoiceNo: `TEMP_EXP_${i}_${Date.now()}` } },
      },
    }));
    for (let i = 0; i < tempOps.length; i += BATCH_SIZE) {
      await expenses.bulkWrite(tempOps.slice(i, i + BATCH_SIZE));
    }
    console.log("  Step 1: Renamed to temporary values");

    // Step 2: Assign new sequential values
    const newOps = allExpenses.map((doc, i) => ({
      updateOne: {
        filter: { _id: doc._id },
        update: {
          $set: { invoiceNo: `EXP-${String(i + 1).padStart(12, "0")}` },
        },
      },
    }));
    for (let i = 0; i < newOps.length; i += BATCH_SIZE) {
      await expenses.bulkWrite(newOps.slice(i, i + BATCH_SIZE));
    }
    console.log(`  Step 2: Updated ${allExpenses.length} expenses (EXP-000000000001 to EXP-${String(allExpenses.length).padStart(12, "0")})`);
  }

  // ─── Set Counters ──────────────────────────────────────────────────────
  console.log("\n--- Setting Counters ---");

  await counters.deleteMany({});
  console.log("Cleared old invoice counters");

  // Drop the old branchId+year index if it still exists
  try {
    await counters.dropIndex("branchId_1_year_1");
    console.log("Dropped old branchId_1_year_1 index");
  } catch {
    // Index may not exist, ignore
  }

  // Ensure the new type index exists
  await counters.createIndex({ type: 1 }, { unique: true });
  console.log("Ensured unique index on type field");

  await counters.insertOne({
    type: "PAYMENT",
    lastSequence: allPayments.length,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  console.log(`PAYMENT counter set to ${allPayments.length}`);

  await counters.insertOne({
    type: "EXPENSE",
    lastSequence: allExpenses.length,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  console.log(`EXPENSE counter set to ${allExpenses.length}`);

  console.log("\nMigration complete.");
  await mongoose.disconnect();
};

run().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
