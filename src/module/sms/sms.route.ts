import { Router } from "express";
import authStaff from "../../middlewares/authStaff";
import validateRequest from "../../middlewares/validateRequest";
import { authLimiter } from "../../middlewares/security";
import { SmsController } from "./sms.controller";
import { SmsDto } from "./sms.dto";

const router = Router();

router.use(authStaff({ allowOwner: true }));

// Read-only endpoints
router.get(
  "/:businessId/branches/:branchId/balance",
  validateRequest(SmsDto.balance),
  SmsController.getBalance,
);

router.get(
  "/:businessId/branches/:branchId/due-members",
  validateRequest(SmsDto.dueMembers),
  SmsController.listDueMembers,
);

router.get(
  "/:businessId/branches/:branchId/history",
  validateRequest(SmsDto.listHistory),
  SmsController.listHistory,
);

router.get(
  "/:businessId/branches/:branchId/members/:memberId/history",
  validateRequest(SmsDto.listMemberHistory),
  SmsController.listMemberHistory,
);

// Write endpoints
router.post(
  "/:businessId/branches/:branchId/preview",
  authLimiter,
  validateRequest(SmsDto.preview),
  SmsController.preview,
);

router.post(
  "/:businessId/branches/:branchId/send",
  authLimiter,
  validateRequest(SmsDto.send),
  SmsController.send,
);

export const SmsRoutes = router;
