import { Router } from "express";
import validateRequest from "@middlewares/validateRequest";
import { StaffController } from "./staff.controller";
import { StaffDto } from "./staff.dto";
import { authLimiter } from "@middlewares/security";
import auth from "@middlewares/auth";

const router = Router();

/**
 * @route   GET /api/v1/staff/usernames/suggest?base=abdullah&limit=6
 * @desc    Suggest available usernames based on input
 * @access  Public (no auth needed for UX)
 */
router.get("/usernames/suggest", StaffController.suggestUsernames);

/**
 * @route   GET /api/v1/staff/usernames/check?username=abdullah01
 * @desc    Check if a specific username is available
 * @access  Public (no auth needed for UX)
 */
router.get("/usernames/check", StaffController.checkUsername);

/**
 * @route   POST /api/v1/staff/:branchId/staff
 * @desc    Create a new staff member for a branch
 * @access  Private (requires authentication)
 */
router.post(
  "/:branchId/staff",
  authLimiter,
  auth(),
  validateRequest(StaffDto.create),
  StaffController.create
);

/**
 * @route   GET /api/v1/staff/:branchId/staff
 * @desc    Get all staff members for a branch with role permissions
 * @access  Private (requires authentication)
 */
router.get(
  "/:branchId/staff",
  auth(),
  StaffController.getAll
);

/**
 * @route   GET /api/v1/staff/:branchId/staff/:staffId
 * @desc    Get a single staff member with role permissions
 * @access  Private (requires authentication)
 */
router.get(
  "/:branchId/staff/:staffId",
  auth(),
  StaffController.getById
);

/**
 * @route   PATCH /api/v1/staff/:branchId/staff/:staffId
 * @desc    Update staff member information
 * @access  Private (requires authentication)
 */
router.patch(
  "/:branchId/staff/:staffId",
  authLimiter,
  auth(),
  validateRequest(StaffDto.update),
  StaffController.update
);

/**
 * @route   PATCH /api/v1/staff/:branchId/staff/:staffId/deactivate
 * @desc    Deactivate a staff member
 * @access  Private (requires authentication)
 */
router.patch(
  "/:branchId/staff/:staffId/deactivate",
  authLimiter,
  auth(),
  StaffController.deactivate
);

/**
 * @route   DELETE /api/v1/staff/:branchId/staff/:staffId
 * @desc    Delete a staff member
 * @access  Private (requires authentication)
 */
router.delete(
  "/:branchId/staff/:staffId",
  authLimiter,
  auth(),
  StaffController.remove
);

export const StaffRoutes = router;
