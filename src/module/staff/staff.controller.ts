import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { Types } from "mongoose";
import catchAsync from "../../shared/catchAsync";
import sendResponse from "../../shared/sendResponse";
import { StaffService } from "./staff.service";

/**
 * Suggest available usernames based on input
 * GET /api/v1/staff/usernames/suggest?base=abdullah
 */
const suggestUsernames = catchAsync(async (req: Request, res: Response) => {
  const base = req.query.base as string;
  const limit = parseInt(req.query.limit as string) || 6;

  const suggestions = await StaffService.suggestUsernames(base, limit);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Username suggestions generated",
    data: { suggestions },
  });
});

/**
 * Check if a specific username is available
 * GET /api/v1/staff/usernames/check?username=abdullah01
 */
const checkUsername = catchAsync(async (req: Request, res: Response) => {
  const username = req.query.username as string;

  const isAvailable = await StaffService.checkUsernameAvailability(username);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: isAvailable ? "Username is available" : "Username is taken",
    data: { username, isAvailable },
  });
});

/**
 * Create a new staff member
 * POST /api/v1/staff/:branchId/staff
 */
const create = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;
  const userId = new Types.ObjectId(req.user?._id);
  const payload = req.body.data || req.body;

  const staff = await StaffService.createStaff(branchId, userId, payload);

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: "Staff member created successfully",
    data: staff,
  });
});

/**
 * Get all staff members for a branch with role permissions
 * GET /api/v1/staff/:branchId/staff
 */
const getAll = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;

  const staffList = await StaffService.getStaffListByBranch(branchId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Staff members retrieved successfully",
    data: staffList,
  });
});

/**
 * Get a single staff member by ID with role permissions
 * GET /api/v1/staff/:branchId/staff/:staffId
 */
const getById = catchAsync(async (req: Request, res: Response) => {
  const staffId = req.params.staffId as string;

  const staff = await StaffService.getStaffById(staffId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Staff member retrieved successfully",
    data: staff,
  });
});

/**
 * Update staff member information
 * PATCH /api/v1/staff/:branchId/staff/:staffId
 */
const update = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;
  const staffId = req.params.staffId as string;
  const payload = req.body.data || req.body;

  const staff = await StaffService.updateStaff(staffId, branchId, payload);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Staff member updated successfully",
    data: staff,
  });
});

/**
 * Deactivate a staff member
 * PATCH /api/v1/staff/:branchId/staff/:staffId/deactivate
 */
const deactivate = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;
  const staffId = req.params.staffId as string;

  const staff = await StaffService.deactivateStaff(staffId, branchId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Staff member deactivated successfully",
    data: staff,
  });
});

/**
 * Delete a staff member
 * DELETE /api/v1/staff/:branchId/staff/:staffId
 */
const remove = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;
  const staffId = req.params.staffId as string;

  const staff = await StaffService.deleteStaff(staffId, branchId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Staff member deleted successfully",
    data: staff,
  });
});

export const StaffController = {
  suggestUsernames,
  checkUsername,
  create,
  getAll,
  getById,
  update,
  deactivate,
  remove,
};
