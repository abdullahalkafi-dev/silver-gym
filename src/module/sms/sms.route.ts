import { Router } from "express";
import authStaff from "../../middlewares/authStaff";
import requirePermission from "../../middlewares/requirePermission";
import validateRequest from "../../middlewares/validateRequest";
import { authLimiter } from "../../middlewares/security";
import { SmsController } from "./sms.controller";
import { SmsDto } from "./sms.dto";

const router = Router();

router.use(authStaff({ allowOwner: true }));

// Read-only endpoints — accessible to both canViewSMS and canSendSMS
router.get(
  "/:businessId/branches/:branchId/balance",
  requirePermission("canViewSMS"),
  validateRequest(SmsDto.balance),
  SmsController.getBalance,
);

router.get(
  "/:businessId/branches/:branchId/due-members",
  requirePermission("canViewSMS"),
  validateRequest(SmsDto.dueMembers),
  SmsController.listDueMembers,
);

router.get(
  "/:businessId/branches/:branchId/history",
  requirePermission("canViewSMS"),
  validateRequest(SmsDto.listHistory),
  SmsController.listHistory,
);

router.get(
  "/:businessId/branches/:branchId/members/:memberId/history",
  requirePermission("canViewSMS"),
  validateRequest(SmsDto.listMemberHistory),
  SmsController.listMemberHistory,
);

// Write endpoints — require canSendSMS
router.post(
  "/:businessId/branches/:branchId/preview",
  requirePermission("canSendSMS"),
  authLimiter,
  validateRequest(SmsDto.preview),
  SmsController.preview,
);

router.post(
  "/:businessId/branches/:branchId/send",
  requirePermission("canSendSMS"),
  authLimiter,
  validateRequest(SmsDto.send),
  SmsController.send,
);

export const SmsRoutes = router;
