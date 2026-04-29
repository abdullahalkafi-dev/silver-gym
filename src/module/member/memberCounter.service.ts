import { Types } from "mongoose";
import { MemberCounter } from "./memberCounter.model";

/**
 * Atomically increments the per-branch counter and returns the next systemMemberId.
 * Used for single member creation.
 */
const getNextSystemMemberId = async (
  branchId: Types.ObjectId | string,
  session?: import("mongoose").ClientSession | null,
): Promise<number> => {
  const branchObjectId =
    typeof branchId === "string" ? new Types.ObjectId(branchId) : branchId;

  const updated = await MemberCounter.findOneAndUpdate(
    { branchId: branchObjectId },
    { $inc: { lastSystemMemberId: 1 } },
    {
      upsert: true,
      returnDocument: "after",
      session,
    },
  );

  return updated!.lastSystemMemberId;
};

/**
 * Atomically reserves a range of systemMemberIds for bulk import.
 * Returns the `startAt` value (the counter value BEFORE increment).
 * Assign IDs: startAt + 1, startAt + 2, ..., startAt + count.
 */
const reserveSystemMemberIdRange = async (
  branchId: Types.ObjectId | string,
  count: number,
  session?: import("mongoose").ClientSession | null,
): Promise<number> => {
  const branchObjectId =
    typeof branchId === "string" ? new Types.ObjectId(branchId) : branchId;

  const updated = await MemberCounter.findOneAndUpdate(
    { branchId: branchObjectId },
    { $inc: { lastSystemMemberId: count } },
    {
      upsert: true,
      returnDocument: "before",
      session,
    },
  );

  // If document didn't exist before upsert, the "before" value is 0
  return updated?.lastSystemMemberId ?? 0;
};

export const MemberCounterService = {
  getNextSystemMemberId,
  reserveSystemMemberIdRange,
};
