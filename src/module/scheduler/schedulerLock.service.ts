import { randomUUID } from "crypto";
import { SchedulerLock } from "./schedulerLock.model";

const instanceId = randomUUID();

const tryAcquireLock = async (
  name: string,
  lockDurationMs: number,
): Promise<boolean> => {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + lockDurationMs);

  try {
    await SchedulerLock.findOneAndUpdate(
      {
        name,
        $or: [
          { expiresAt: { $lte: now } },
          { lockedBy: instanceId },
        ],
      },
      {
        $set: {
          lockedAt: now,
          expiresAt,
          lockedBy: instanceId,
        },
      },
      {
        upsert: true,
      },
    );

    const lock = await SchedulerLock.findOne({ name, lockedBy: instanceId });
    return lock !== null && lock.expiresAt.getTime() === expiresAt.getTime();
  } catch {
    return false;
  }
};

export const SchedulerLockService = {
  tryAcquireLock,
};
