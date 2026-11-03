import { Router } from "express";
import authStaff from "../../middlewares/authStaff";
import validateRequest from "../../middlewares/validateRequest";
import { authLimiter } from "../../middlewares/security";
import { requireSmsAccess, requireSmsAdmin } from "./sms.access";
import { SmsController } from "./sms.controller";
import { SmsDto } from "./sms.dto";

const router = Router();

router.use(authStaff({ allowOwner: true }));
router.use(requireSmsAccess);

const base = "/:businessId/branches/:branchId";

// Read
router.get(`${base}/balance`, validateRequest(SmsDto.balance), SmsController.getBalance);
router.get(`${base}/settings`, validateRequest(SmsDto.settings), SmsController.getSettings);
router.get(`${base}/due-members`, validateRequest(SmsDto.dueMembers), SmsController.listDueMembers);
router.get(`${base}/holidays`, validateRequest(SmsDto.holidays), SmsController.listHolidays);
router.get(`${base}/history`, validateRequest(SmsDto.listHistory), SmsController.listHistory);
router.get(`${base}/history/batches`, validateRequest(SmsDto.listHistory), SmsController.listBatches);
router.get(
  `${base}/members/:memberId/history`,
  validateRequest(SmsDto.listMemberHistory),
  SmsController.listMemberHistory,
);

// Owner / admin only: these change what the app sends on its own
router.patch(
  `${base}/settings`,
  authLimiter,
  requireSmsAdmin,
  validateRequest(SmsDto.updateSettings),
  SmsController.updateSettings,
);
router.post(`${base}/test`, authLimiter, requireSmsAdmin, validateRequest(SmsDto.test), SmsController.sendTest);

// Anyone with SMS access
router.post(`${base}/preview`, authLimiter, validateRequest(SmsDto.preview), SmsController.preview);
router.post(`${base}/send`, authLimiter, validateRequest(SmsDto.send), SmsController.send);
router.post(`${base}/holidays`, authLimiter, validateRequest(SmsDto.createHoliday), SmsController.createHoliday);
router.delete(
  `${base}/holidays/:holidayId`,
  authLimiter,
  validateRequest(SmsDto.deleteHoliday),
  SmsController.deleteHoliday,
);
router.post(
  `${base}/history/batches/:requestId/retry`,
  authLimiter,
  validateRequest(SmsDto.retry),
  SmsController.retryFailed,
);

export const SmsRoutes = router;
