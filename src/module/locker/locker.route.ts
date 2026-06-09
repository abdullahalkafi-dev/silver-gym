import { Router } from "express";

import authStaff from "@middlewares/authStaff";
import requirePermission from "@middlewares/requirePermission";
import { authLimiter } from "@middlewares/security";
import validateRequest from "@middlewares/validateRequest";
import { LockerController } from "./locker.controller";
import { LockerDto } from "./locker.dto";

const router = Router();

// ─── Branch-level routes (static paths BEFORE dynamic :lockerId) ────────────

/**
 * @route   POST /api/v1/lockers/:branchId
 * @desc    Create lockers in bulk
 * @access  Private (Owner or Staff with canManageLockers)
 */
router.post(
  "/:branchId",
  authLimiter,
  authStaff({ allowOwner: true }),
  requirePermission("canManageLockers"),
  validateRequest(LockerDto.createLockers),
  LockerController.createLockers,
);

/**
 * @route   GET /api/v1/lockers/:branchId
 * @desc    Get all lockers for a branch
 * @access  Private (Owner or Staff)
 */
router.get(
  "/:branchId",
  authStaff({ allowOwner: true }),
  LockerController.getLockers,
);

/**
 * @route   GET /api/v1/lockers/:branchId/stats
 * @desc    Get locker stats (counts by status)
 * @access  Private (Owner or Staff)
 */
router.get(
  "/:branchId/stats",
  authStaff({ allowOwner: true }),
  LockerController.getLockerStats,
);

/**
 * @route   GET /api/v1/lockers/:branchId/fee
 * @desc    Get branch locker fee amount
 * @access  Private (Owner or Staff)
 */
router.get(
  "/:branchId/fee",
  authStaff({ allowOwner: true }),
  LockerController.getLockerFee,
);

/**
 * @route   PATCH /api/v1/lockers/:branchId/pricing
 * @desc    Set default locker price for branch
 * @access  Private (Owner or Staff with canManageLockers)
 */
router.patch(
  "/:branchId/pricing",
  authLimiter,
  authStaff({ allowOwner: true }),
  requirePermission("canManageLockers"),
  validateRequest(LockerDto.setBranchPrice),
  LockerController.setBranchLockerPrice,
);

// ─── Locker-specific routes (dynamic :lockerId) ─────────────────────────────

/**
 * @route   GET /api/v1/lockers/:branchId/:lockerId
 * @desc    Get single locker by ID
 * @access  Private (Owner or Staff)
 */
router.get(
  "/:branchId/:lockerId",
  authStaff({ allowOwner: true }),
  LockerController.getLockerById,
);

/**
 * @route   PATCH /api/v1/lockers/:branchId/:lockerId
 * @desc    Update locker (status, number)
 * @access  Private (Owner or Staff with canManageLockers)
 */
router.patch(
  "/:branchId/:lockerId",
  authLimiter,
  authStaff({ allowOwner: true }),
  requirePermission("canManageLockers"),
  validateRequest(LockerDto.updateLocker),
  LockerController.updateLocker,
);

/**
 * @route   DELETE /api/v1/lockers/:branchId/:lockerId
 * @desc    Soft delete a locker
 * @access  Private (Owner or Staff with canManageLockers)
 */
router.delete(
  "/:branchId/:lockerId",
  authLimiter,
  authStaff({ allowOwner: true }),
  requirePermission("canManageLockers"),
  LockerController.deleteLocker,
);

/**
 * @route   PATCH /api/v1/lockers/:branchId/:lockerId/pricing
 * @desc    Set custom price for individual locker
 * @access  Private (Owner or Staff with canManageLockers)
 */
router.patch(
  "/:branchId/:lockerId/pricing",
  authLimiter,
  authStaff({ allowOwner: true }),
  requirePermission("canManageLockers"),
  validateRequest(LockerDto.setCustomPrice),
  LockerController.setCustomLockerPrice,
);

/**
 * @route   POST /api/v1/lockers/:branchId/:lockerId/pricing/reset
 * @desc    Reset locker to system price
 * @access  Private (Owner or Staff with canManageLockers)
 */
router.post(
  "/:branchId/:lockerId/pricing/reset",
  authLimiter,
  authStaff({ allowOwner: true }),
  requirePermission("canManageLockers"),
  LockerController.resetToSystemPrice,
);

/**
 * @route   POST /api/v1/lockers/:branchId/:lockerId/assign
 * @desc    Assign member to locker (with first payment)
 * @access  Private (Owner or Staff with canManageLockers)
 */
router.post(
  "/:branchId/:lockerId/assign",
  authLimiter,
  authStaff({ allowOwner: true }),
  requirePermission("canManageLockers"),
  validateRequest(LockerDto.assignMember),
  LockerController.assignMember,
);

/**
 * @route   POST /api/v1/lockers/:branchId/:lockerId/collect
 * @desc    Collect locker payment
 * @access  Private (Owner or Staff with canManageLockers)
 */
router.post(
  "/:branchId/:lockerId/collect",
  authLimiter,
  authStaff({ allowOwner: true }),
  requirePermission("canManageLockers"),
  validateRequest(LockerDto.collectPayment),
  LockerController.collectLockerPayment,
);

/**
 * @route   POST /api/v1/lockers/:branchId/:lockerId/unassign
 * @desc    Unassign member from locker
 * @access  Private (Owner or Staff with canManageLockers)
 */
router.post(
  "/:branchId/:lockerId/unassign",
  authLimiter,
  authStaff({ allowOwner: true }),
  requirePermission("canManageLockers"),
  LockerController.unassignMember,
);

/**
 * @route   GET /api/v1/lockers/:branchId/:lockerId/payments
 * @desc    Get payment history for a locker
 * @access  Private (Owner or Staff)
 */
router.get(
  "/:branchId/:lockerId/payments",
  authStaff({ allowOwner: true }),
  LockerController.getLockerPaymentHistory,
);

export const LockerRoutes = router;
