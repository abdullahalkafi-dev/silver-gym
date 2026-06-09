import { Router } from "express";

import authStaff from "@middlewares/authStaff";
import requirePermission from "@middlewares/requirePermission";
import { authLimiter } from "@middlewares/security";
import validateRequest from "@middlewares/validateRequest";
import { PackageController } from "./package.controller";
import { PackageDto } from "./package.dto";

const router = Router();

/**
 * @route   POST /api/v1/packages/:branchId
 * @desc    Create a new package
 * @access  Private (Owner or Staff with canManagePackages)
 */
router.post(
  "/:branchId",
  authLimiter,
  authStaff({ allowOwner: true }),
  requirePermission("canManagePackages"),
  validateRequest(PackageDto.create),
  PackageController.create,
);

/**
 * @route   GET /api/v1/packages/:branchId
 * @desc    Get packages list for a branch
 * @access  Private (Owner or Staff)
 */
router.get(
  "/:branchId",
  authStaff({ allowOwner: true }),
  validateRequest(PackageDto.query),
  PackageController.getAll,
);

/**
 * @route   GET /api/v1/packages/:branchId/:packageId
 * @desc    Get a single package by ID
 * @access  Private (Owner or Staff)
 */
router.get(
  "/:branchId/:packageId",
  authStaff({ allowOwner: true }),
  PackageController.getById,
);

/**
 * @route   PATCH /api/v1/packages/:branchId/:packageId
 * @desc    Update package details
 * @access  Private (Owner or Staff with canManagePackages)
 */
router.patch(
  "/:branchId/:packageId",
  authLimiter,
  authStaff({ allowOwner: true }),
  requirePermission("canManagePackages"),
  validateRequest(PackageDto.update),
  PackageController.update,
);

/**
 * @route   DELETE /api/v1/packages/:branchId/:packageId
 * @desc    Soft delete package
 * @access  Private (Owner or Staff with canManagePackages)
 */
router.delete(
  "/:branchId/:packageId",
  authLimiter,
  authStaff({ allowOwner: true }),
  requirePermission("canManagePackages"),
  PackageController.remove,
);

/**
 * @route   PATCH /api/v1/packages/:branchId/:packageId/restore
 * @desc    Restore soft-deleted package
 * @access  Private (Owner or Staff with canManagePackages)
 */
router.patch(
  "/:branchId/:packageId/restore",
  authLimiter,
  authStaff({ allowOwner: true }),
  requirePermission("canManagePackages"),
  PackageController.restore,
);

export default router;
