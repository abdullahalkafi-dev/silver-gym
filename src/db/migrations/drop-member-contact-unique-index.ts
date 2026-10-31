/**
 * Migration: drop the unique (branchId, contact) index on members.
 *
 * Why: branches can now allow duplicate phone numbers on import
 * (Branch.allowDuplicatePhoneOnImport). Phone uniqueness for add/edit is enforced
 * in member.service, not by this index.
 *
 * Until this runs, imports with duplicate phones still fail with a duplicate key
 * error even if the branch setting is on. It is safe to run any time after the
 * new backend is deployed. It is idempotent and only touches this one index.
 *
 * Usage (dry run lists the index and changes nothing):
 *   npx ts-node -r tsconfig-paths/register src/db/migrations/drop-member-contact-unique-index.ts --dry-run
 *   npx ts-node -r tsconfig-paths/register src/db/migrations/drop-member-contact-unique-index.ts
 *
 * Rollback (only possible while no branch has duplicate phones):
 *   db.members.createIndex({ branchId: 1, contact: 1 }, { unique: true,
 *     partialFilterExpression: { contact: { $exists: true, $gt: "" } } })
 */

import mongoose from "mongoose";
import config from "../../config";

const INDEX_NAME = "branchId_1_contact_1";

const run = async () => {
  const dryRun = process.argv.includes("--dry-run");

  await mongoose.connect(config.database_url as string);
  console.log("Connected to MongoDB");

  const db = mongoose.connection.db;
  if (!db) {
    throw new Error("Database connection is not established");
  }
  const members = db.collection("members");

  const indexes = await members.indexes();
  const target = indexes.find((index) => index.name === INDEX_NAME);

  if (!target) {
    console.log(`Index ${INDEX_NAME} not found — nothing to do.`);
  } else if (!target.unique) {
    console.log(`Index ${INDEX_NAME} exists but is not unique — leaving it alone.`);
  } else if (dryRun) {
    console.log(`[dry-run] Would drop unique index ${INDEX_NAME}:`, JSON.stringify(target));
  } else {
    await members.dropIndex(INDEX_NAME);
    console.log(`Dropped unique index ${INDEX_NAME}`);
  }

  await mongoose.disconnect();
};

run().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
