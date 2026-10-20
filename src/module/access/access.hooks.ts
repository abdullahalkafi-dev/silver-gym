import { logger } from "../../logger/logger";
import { resyncMemberOnDevices } from "./access.deviceSync";

const pending = new Map<string, NodeJS.Timeout>();
const DEBOUNCE_MS = 2000;

/**
 * Call after anything that can change whether a member may enter: a payment,
 * a refund, activating/deactivating a member, editing the member id.
 *
 * Fire-and-forget and error-proof on purpose: a door problem must never make a
 * payment or a member edit fail.
 */
export const queueMemberDoorResync = (branchId: string, memberId: string) => {
  try {
    const key = `${branchId}:${memberId}`;
    const existing = pending.get(key);
    if (existing) clearTimeout(existing);

    pending.set(
      key,
      setTimeout(() => {
        pending.delete(key);
        resyncMemberOnDevices(branchId, memberId).catch((error) =>
          logger.warn("Door resync failed", {
            branchId,
            memberId,
            reason: error instanceof Error ? error.message : String(error),
          }),
        );
      }, DEBOUNCE_MS),
    );
  } catch {
    // never throw into the caller
  }
};
