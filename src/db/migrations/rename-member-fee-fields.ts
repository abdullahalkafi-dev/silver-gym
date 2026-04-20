/**
 * Migration: rename member-level custom fee fields
 *
 * Changes:
 *   customMonthlyFee   → isCustomMonthlyFee
 *   monthlyFeeAmount   → customMonthlyFeeAmount
 *
 * Run BEFORE deploying the application code that uses the new field names.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register src/db/migrations/rename-member-fee-fields.ts
 */

import mongoose from "mongoose";
import config from "../../config";

const run = async () => {
  await mongoose.connect(config.database_url as string);
  console.log("Connected to MongoDB");

  const db = mongoose.connection.db;
  if (!db) {
    throw new Error("Database connection is not established");
  }
  const members = db.collection("members");

  // Step 1: rename customMonthlyFee → isCustomMonthlyFee
  const renameCustomMonthlyFee = await members.updateMany(
    { customMonthlyFee: { $exists: true } },
    { $rename: { customMonthlyFee: "isCustomMonthlyFee" } },
  );
  console.log(
    `Renamed customMonthlyFee → isCustomMonthlyFee on ${renameCustomMonthlyFee.modifiedCount} documents`,
  );

  // Step 2: rename monthlyFeeAmount → customMonthlyFeeAmount
  const renameMonthlyFeeAmount = await members.updateMany(
    { monthlyFeeAmount: { $exists: true } },
    { $rename: { monthlyFeeAmount: "customMonthlyFeeAmount" } },
  );
  console.log(
    `Renamed monthlyFeeAmount → customMonthlyFeeAmount on ${renameMonthlyFeeAmount.modifiedCount} documents`,
  );

  console.log("Migration complete.");
  await mongoose.disconnect();
};

run().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
