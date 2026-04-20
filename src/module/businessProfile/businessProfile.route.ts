import { Router } from "express";
import validateRequest from "@middlewares/validateRequest";
import { BusinessProfileController } from "./businessProfile.controller";
import { BusinessProfileDto } from "./businessProfile.dto";
import { authLimiter } from "@middlewares/security";
import auth from "@middlewares/auth";
import fileUploadHandler from "@middlewares/fileUploadHandler";

const router = Router();

/**
 * @route   POST /api/v1/business-profile
 * @desc    Create business profile with logo upload (creates default branch automatically)
 * @access  Private (requires authentication)
 */
router.post(
  "/",
  authLimiter,
  auth(),
  fileUploadHandler,
  validateRequest(BusinessProfileDto.create),
  BusinessProfileController.create
);

/**
 * @route   GET /api/v1/business-profile
 * @desc    Get authenticated user's business profile
 * @access  Private (requires authentication)
 */
router.get(
  "/",
  auth(),
  BusinessProfileController.get
);

/**
 * @route   PATCH /api/v1/business-profile
 * @desc    Update business profile with optional logo update
 * @access  Private (requires authentication)
 */
router.patch(
  "/",
  authLimiter,
  auth(),
  fileUploadHandler,
  validateRequest(BusinessProfileDto.update),
  BusinessProfileController.update
);

export const BusinessProfileRoutes = router;
