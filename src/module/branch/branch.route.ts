import { Router } from "express";
import validateRequest from "@middlewares/validateRequest";
import { BranchController } from "./branch.controller";
import { BranchDto } from "./branch.dto";
import { authLimiter } from "@middlewares/security";
import auth from "@middlewares/auth";
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

export const BranchRoutes = router;
