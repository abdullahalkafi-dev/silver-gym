import { logger } from "../../logger/logger";
import { SchedulerLockService } from "../scheduler/schedulerLock.service";
import { runAccessSyncSweep } from "./access.deviceSync";
import { AccessService } from "./access.service";

const PULL_INTERVAL_MS = 60 * 1000;
const LOCK_DURATION_MS = 5 * 60 * 1000;
const LOCK_NAME = "access-attendance-pull";

const SYNC_EVERY_N_TICKS = 10; // door list is re-checked every 10 minutes
const SYNC_LOCK_NAME = "access-door-sync";
let tick = 0;
let schedulerHandle: NodeJS.Timeout | null = null;
let running = false;

export const runAttendancePullSweep = async () => {
  if (running) {
    return;
  }
  running = true;

  const locked = await SchedulerLockService.tryAcquireLock(
    LOCK_NAME,
    LOCK_DURATION_MS,
  );

  if (!locked) {
    running = false;
    return;
  }

  try {
    const result = await AccessService.runPullForAllDevices();
    if (result.inserted > 0) {
      logger.info("Attendance pull completed", result);
    }
  } catch (error) {
    logger.error("Attendance pull sweep failed", {
      reason: error instanceof Error ? error.message : String(error),
    });
  } finally {
    await SchedulerLockService.releaseLock(LOCK_NAME);
    running = false;
  }
};

export const runDoorSyncSweep = async () => {
  const locked = await SchedulerLockService.tryAcquireLock(
    SYNC_LOCK_NAME,
    LOCK_DURATION_MS,
  );
  if (!locked) return;

  try {
    const result = await runAccessSyncSweep();
    if (result.applied > 0) {
      logger.info("Door access sync completed", result);
    }
  } catch (error) {
    logger.error("Door access sync sweep failed", {
      reason: error instanceof Error ? error.message : String(error),
    });
  } finally {
    await SchedulerLockService.releaseLock(SYNC_LOCK_NAME);
  }
};

const startScheduler = () => {
  if (schedulerHandle) {
    return;
  }

  schedulerHandle = setInterval(() => {
    tick += 1;
    void runAttendancePullSweep();
    if (tick % SYNC_EVERY_N_TICKS === 0) {
      void runDoorSyncSweep();
    }
  }, PULL_INTERVAL_MS);

  void runAttendancePullSweep();

  logger.info("Attendance pull scheduler started", {
    intervalMs: PULL_INTERVAL_MS,
  });
};

export const AccessScheduler = { startScheduler };
