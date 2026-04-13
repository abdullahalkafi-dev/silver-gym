import { Router } from "express";
import validateRequest from "@middlewares/validateRequest";
import { BranchController } from "./branch.controller";
import { BranchDto } from "./branch.dto";
import { authLimiter } from "@middlewares/security";
import auth from "@middlewares/auth";
import authStaff from "@middlewares/authStaff";
import fileUploadHandler from "@middlewares/fileUploadHandler";

const router = Router();

/**
 * @route   POST /api/v1/branches/:businessId/branches
 * @desc    Create a new branch for a business
 * @access  Private (requires authentication)
 */
router.post(
  "/:businessId/branches",
  authLimiter,
  auth(),
  fileUploadHandler,
  validateRequest(BranchDto.create),
  BranchController.create
);

/**
 * @route   GET /api/v1/branches/:businessId/branches
 * @desc    Get all branches for a business
 * @access  Private (requires authentication)
 */
router.get(
  "/:businessId/branches",
  auth(),
  BranchController.getAll
);

/**
 * @route   GET /api/v1/branches/:businessId/default
 * @desc    Get default branch for a business
 * @access  Private (requires authentication)
 */
router.get(
  "/:businessId/default",
  auth(),
  BranchController.getDefault
);

/**
 * @route   PATCH /api/v1/branches/:businessId/branches/:branchId
 * @desc    Update branch information with optional logo
 * @access  Private (requires authentication)
 */
router.patch(
  "/:businessId/branches/:branchId",
  authLimiter,
  auth(),
  fileUploadHandler,
  validateRequest(BranchDto.update),
  BranchController.update
);

/**
 * @route   GET /api/v1/branches/:businessId/branches/:branchId/monthly-fee
 * @desc    Get branch monthly fee
 * @access  Private (Owner or authenticated branch staff)
 */
router.get(
  "/:businessId/branches/:branchId/monthly-fee",
  authStaff({ allowOwner: true }),
  BranchController.getMonthlyFee
);

/**
 * @route   PATCH /api/v1/branches/:businessId/branches/:branchId/monthly-fee
 * @desc    Update branch monthly fee
 * @access  Private (Owner or authenticated branch staff; service enforces add/edit fee permissions)
 */
router.patch(
  "/:businessId/branches/:branchId/monthly-fee",
  authLimiter,
  authStaff({ allowOwner: true }),
  validateRequest(BranchDto.updateMonthlyFee),
  BranchController.updateMonthlyFee
);

/**
 * @route   GET /api/v1/branches/:businessId/branches/:branchId/admission-fee
 * @desc    Get branch admission fee
 * @access  Private (Owner or authenticated branch staff)
 */
router.get(
  "/:businessId/branches/:branchId/admission-fee",
  authStaff({ allowOwner: true }),
  BranchController.getAdmissionFee
);

/**
 * @route   PATCH /api/v1/branches/:businessId/branches/:branchId/admission-fee
 * @desc    Update branch admission fee
 * @access  Private (Owner or authenticated branch staff; service enforces add/edit fee permissions)
 */
router.patch(
  "/:businessId/branches/:branchId/admission-fee",
  authLimiter,
  authStaff({ allowOwner: true }),
  validateRequest(BranchDto.updateAdmissionFee),
  BranchController.updateAdmissionFee
);

export const BranchRoutes = router;
