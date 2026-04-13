import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { Types } from "mongoose";
import AppError from "../../errors/AppError";
import catchAsync from "../../shared/catchAsync";
import sendResponse from "../../shared/sendResponse";
import { BranchService } from "./branch.service";

const resolveActor = (req: Request) => {
  if (req.user?._id) {
    return {
      userId: new Types.ObjectId(req.user._id),
    };
  }

  if (req.staff) {
    return {
      staff: req.staff,
      staffPermissions: req.staffPermissions,
    };
  }

  throw new AppError(StatusCodes.UNAUTHORIZED, "You are not authorized");
};

/**
 * Create new branch
 * POST /api/v1/branches/:businessId/branches
 */
const create = catchAsync(async (req: Request, res: Response) => {
  const businessId = req.params.businessId as string;
  const userId = new Types.ObjectId(req.user?._id);
  const logoFile = (req.files as any)?.image?.[0] as Express.Multer.File | undefined;

  // Use parsed data if available, otherwise use body
  const payload = req.body.data || req.body;

  const branch = await BranchService.createBranch(
    businessId,
    userId,
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
  const userId = new Types.ObjectId(req.user?._id);

  const branches = await BranchService.getBranches(businessId, userId);

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
  const userId = new Types.ObjectId(req.user?._id);

  const branch = await BranchService.getDefaultBranch(businessId, userId);

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
  const businessId = req.params.businessId as string;
  const branchId = req.params.branchId as string;
  const userId = new Types.ObjectId(req.user?._id);
  const logoFile = (req.files as any)?.image?.[0] as Express.Multer.File | undefined;

  // Use parsed data if available, otherwise use body
  const payload = req.body.data || req.body;

  const branch = await BranchService.updateBranch(
    branchId,
    businessId,
    userId,
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

/**
 * Get branch monthly fee
 * GET /api/v1/branches/:businessId/branches/:branchId/monthly-fee
 */
const getMonthlyFee = catchAsync(async (req: Request, res: Response) => {
  const businessId = req.params.businessId as string;
  const branchId = req.params.branchId as string;

  const result = await BranchService.getBranchMonthlyFee(
    businessId,
    branchId,
    resolveActor(req)
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Branch monthly fee retrieved successfully",
    data: result,
  });
});

/**
 * Update branch monthly fee
 * PATCH /api/v1/branches/:businessId/branches/:branchId/monthly-fee
 */
const updateMonthlyFee = catchAsync(async (req: Request, res: Response) => {
  const businessId = req.params.businessId as string;
  const branchId = req.params.branchId as string;
  const payload = req.body.data || req.body;

  const result = await BranchService.updateBranchMonthlyFee(
    businessId,
    branchId,
    resolveActor(req),
    payload.monthlyFeeAmount
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Branch monthly fee updated successfully",
    data: result,
  });
});

/**
 * Get branch admission fee
 * GET /api/v1/branches/:businessId/branches/:branchId/admission-fee
 */
const getAdmissionFee = catchAsync(async (req: Request, res: Response) => {
  const businessId = req.params.businessId as string;
  const branchId = req.params.branchId as string;

  const result = await BranchService.getBranchAdmissionFee(
    businessId,
    branchId,
    resolveActor(req)
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Branch admission fee retrieved successfully",
    data: result,
  });
});

/**
 * Update branch admission fee
 * PATCH /api/v1/branches/:businessId/branches/:branchId/admission-fee
 */
const updateAdmissionFee = catchAsync(async (req: Request, res: Response) => {
  const businessId = req.params.businessId as string;
  const branchId = req.params.branchId as string;
  const payload = req.body.data || req.body;

  const result = await BranchService.updateBranchAdmissionFee(
    businessId,
    branchId,
    resolveActor(req),
    payload.admissionFeeAmount
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Branch admission fee updated successfully",
    data: result,
  });
});

export const BranchController = {
  create,
  getAll,
  getDefault,
  update,
  getMonthlyFee,
  updateMonthlyFee,
  getAdmissionFee,
  updateAdmissionFee,
};
