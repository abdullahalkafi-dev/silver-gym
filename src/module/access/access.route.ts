import { Router } from "express";

import authStaff from "@middlewares/authStaff";
import requirePermission from "@middlewares/requirePermission";
import { authLimiter } from "@middlewares/security";
import validateRequest from "@middlewares/validateRequest";
import { AccessController } from "./access.controller";
import { AccessDto } from "./access.dto";

const router = Router();

// Reads: owner or any staff of the branch.
// Writes: owner or staff with canManageMembers (a dedicated permission can be added later).
const read = [authStaff({ allowOwner: true })];
const write = [
  authLimiter,
  authStaff({ allowOwner: true }),
  requirePermission("canManageMembers"),
];

router.get("/:branchId/settings", ...read, AccessController.getSettings);
router.patch(
  "/:branchId/settings",
  ...write,
  validateRequest(AccessDto.updateSettings),
  AccessController.updateSettings,
);

router.get("/:branchId/id-health", ...read, AccessController.getIdHealth);
router.get("/:branchId/preview", ...read, AccessController.getPreview);

router.get("/:branchId/devices", ...read, AccessController.listDevices);
router.post(
  "/:branchId/devices",
  ...write,
  validateRequest(AccessDto.createDevice),
  AccessController.createDevice,
);
router.patch(
  "/:branchId/devices/:deviceId",
  ...write,
  validateRequest(AccessDto.updateDevice),
  AccessController.updateDevice,
);
router.post("/:branchId/devices/:deviceId/test", ...write, AccessController.testDevice);
router.post("/:branchId/devices/:deviceId/sync", ...write, AccessController.syncDevice);

router.get(
  "/:branchId/devices/:deviceId/access-plan",
  ...read,
  AccessController.getDeviceAccessPlan,
);
router.post(
  "/:branchId/devices/:deviceId/access-sync",
  ...write,
  validateRequest(AccessDto.accessSync),
  AccessController.syncDeviceAccess,
);
router.post(
  "/:branchId/devices/:deviceId/test-user",
  ...write,
  validateRequest(AccessDto.testUser),
  AccessController.testUserState,
);
router.post(
  "/:branchId/devices/:deviceId/release-all",
  ...write,
  AccessController.releaseAll,
);

router.get("/:branchId/attendance", ...read, AccessController.getDayAttendance);
router.get(
  "/:branchId/members/:memberId/attendance",
  ...read,
  AccessController.getMemberAttendance,
);
router.patch(
  "/:branchId/members/:memberId/override",
  ...write,
  validateRequest(AccessDto.memberOverride),
  AccessController.setMemberOverride,
);

export const AccessRoutes = router;
