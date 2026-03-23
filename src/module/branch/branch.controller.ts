import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import catchAsync from "../../shared/catchAsync";
import sendResponse from "../../shared/sendResponse";
import { BranchService } from "./branch.service";

/**
 * Create new branch
 * POST /api/v1/branches/:businessId/branches
 */
const create = catchAsync(async (req: Request, res: Response) => {
  const businessId = req.params.businessId as string;
  const logoFile = (req.files as any)?.image?.[0] as Express.Multer.File | undefined;

  // Use parsed data if available, otherwise use body
  const payload = req.body.data || req.body;

  const branch = await BranchService.createBranch(
    businessId,
    payload,
    logoFile
  );

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: "Branch created successfully",
    data: branch,
  });
});

/**
 * Get all branches for a business
 * GET /api/v1/branches/:businessId/branches
 */
const getAll = catchAsync(async (req: Request, res: Response) => {
  const businessId = req.params.businessId as string;

  const branches = await BranchService.getBranches(businessId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Branches retrieved successfully",
    data: branches,
  });
});

/**
 * Get default branch for a business
 * GET /api/v1/branches/:businessId/default
 */
const getDefault = catchAsync(async (req: Request, res: Response) => {
  const businessId = req.params.businessId as string;

  const branch = await BranchService.getDefaultBranch(businessId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Default branch retrieved successfully",
    data: branch,
  });
});

/**
 * Update branch information
 * PATCH /api/v1/branches/:businessId/branches/:branchId
 */
const update = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;
  const logoFile = (req.files as any)?.image?.[0] as Express.Multer.File | undefined;

  // Use parsed data if available, otherwise use body
  const payload = req.body.data || req.body;

  const branch = await BranchService.updateBranch(
    branchId,
    payload,
    logoFile
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Branch updated successfully",
    data: branch,
  });
});

export const BranchController = {
  create,
  getAll,
  getDefault,
  update,
};
