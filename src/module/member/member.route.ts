import { Router } from "express";

import authStaff from "@middlewares/authStaff";
import fileUploadHandler from "@middlewares/fileUploadHandler";
import requirePermission from "@middlewares/requirePermission";
import { authLimiter } from "@middlewares/security";
import validateRequest from "@middlewares/validateRequest";
import { MemberController } from "./member.controller";
import { MemberDto } from "./member.dto";

const router = Router();

/**
 * @route   POST /api/v1/members/import/:branchId/google-sheet
 * @desc    Start async member import from Google Sheets
 * @access  Private (Owner or Staff with canAddMember)
 */
router.post(
  "/import/:branchId/google-sheet",
  authLimiter,
  authStaff({ allowOwner: true }),
  requirePermission("canAddMember"),
  validateRequest(MemberDto.startGoogleSheetImport),
  MemberController.startGoogleSheetImport,
);

/**
 * @route   POST /api/v1/members/import/:branchId/csv
 * @desc    Start async member import from CSV file upload
 * @access  Private (Owner or Staff with canAddMember)
 */
router.post(
  "/import/:branchId/csv",
  authLimiter,
  authStaff({ allowOwner: true }),
  requirePermission("canAddMember"),
  fileUploadHandler,
  validateRequest(MemberDto.startCSVImport),
  MemberController.startCSVImport,
);

/**
 * @route   GET /api/v1/members/import/:branchId/batches
 * @desc    List import batches with optional status filter
 * @access  Private (Owner or Staff with canViewMembers)
 */
router.get(
  "/import/:branchId/batches",
  authStaff({ allowOwner: true }),
  requirePermission("canViewMembers"),
  validateRequest(MemberDto.listImportBatches),
  MemberController.listImportBatches,
);

/**
 * @route   GET /api/v1/members/import/:branchId/metrics
 * @desc    Get import metrics summary for branch monitoring
 * @access  Private (Owner or Staff with canViewMembers)
 */
router.get(
  "/import/:branchId/metrics",
  authStaff({ allowOwner: true }),
  requirePermission("canViewMembers"),
  validateRequest(MemberDto.importMetrics),
  MemberController.getImportMetrics,
);

/**
 * @route   GET /api/v1/members/import/:branchId/dashboard-summary
 * @desc    Get combined member + import dashboard summary for branch
 * @access  Private (Owner or Staff with canViewMembers)
 */
router.get(
  "/import/:branchId/dashboard-summary",
  authStaff({ allowOwner: true }),
  requirePermission("canViewMembers"),
  validateRequest(MemberDto.dashboardSummary),
  MemberController.getDashboardSummary,
);

/**
 * @route   GET /api/v1/members/import/:branchId/batches/:batchId
 * @desc    Get import batch status
 * @access  Private (Owner or Staff with canViewMembers)
 */
router.get(
  "/import/:branchId/batches/:batchId",
  authStaff({ allowOwner: true }),
  requirePermission("canViewMembers"),
  MemberController.getImportBatchStatus,
);

/**
 * @route   POST /api/v1/members/import/:branchId/batches/:batchId/retry
 * @desc    Retry failed import rows for a batch
 * @access  Private (Owner or Staff with canAddMember)
 */
router.post(
  "/import/:branchId/batches/:batchId/retry",
  authLimiter,
  authStaff({ allowOwner: true }),
  requirePermission("canAddMember"),
  validateRequest(MemberDto.retryImport),
  MemberController.retryImportBatch,
);

/**
 * @route   POST /api/v1/members/import/:branchId/batches/:batchId/cancel
 * @desc    Request cancellation of an import batch
 * @access  Private (Owner or Staff with canAddMember)
 */
router.post(
  "/import/:branchId/batches/:batchId/cancel",
  authLimiter,
  authStaff({ allowOwner: true }),
  requirePermission("canAddMember"),
  validateRequest(MemberDto.retryImport),
  MemberController.cancelImportBatch,
);

/**
 * @route   POST /api/v1/members/:branchId
 * @desc    Create member with mandatory payment
 * @access  Private (Owner or Staff with canAddMember)
 */
router.post(
  "/:branchId",
  authLimiter,
  authStaff({ allowOwner: true }),
  requirePermission("canAddMember"),
  fileUploadHandler,
  validateRequest(MemberDto.create),
  MemberController.create,
);

/**
 * @route   GET /api/v1/members/:branchId
 * @desc    Get members list for a branch
 * @access  Private (Owner or Staff with canViewMembers)
 */
router.get(
  "/:branchId",
  authStaff({ allowOwner: true }),
  requirePermission("canViewMembers"),
  validateRequest(MemberDto.listMembers),
  MemberController.getAll,
);

/**
 * @route   GET /api/v1/members/:branchId/:memberId
 * @desc    Get a single member by ID
 * @access  Private (Owner or Staff with canViewMembers)
 */
router.get(
  "/:branchId/:memberId",
  authStaff({ allowOwner: true }),
  requirePermission("canViewMembers"),
  MemberController.getById,
);

/**
 * @route   PATCH /api/v1/members/:branchId/:memberId
 * @desc    Update member details
 * @access  Private (Owner or Staff with canEditMember)
 */
router.patch(
  "/:branchId/:memberId",
  authLimiter,
  authStaff({ allowOwner: true }),
  requirePermission("canEditMember"),
  fileUploadHandler,
  validateRequest(MemberDto.update),
  MemberController.update,
);

/**
 * @route   DELETE /api/v1/members/:branchId/:memberId
 * @desc    Soft delete member
 * @access  Private (Owner or Staff with canDeleteMember)
 */
router.delete(
  "/:branchId/:memberId",
  authLimiter,
  authStaff({ allowOwner: true }),
  requirePermission("canDeleteMember"),
  MemberController.remove,
);

/**
 * @route   PATCH /api/v1/members/:branchId/:memberId/restore
 * @desc    Restore soft-deleted member
 * @access  Private (Owner or Staff with canEditMember)
 */
router.patch(
  "/:branchId/:memberId/restore",
  authLimiter,
  authStaff({ allowOwner: true }),
  requirePermission("canEditMember"),
  MemberController.restore,
);

export const MemberRoutes = router;
