import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import catchAsync from "../../shared/catchAsync";
import sendResponse from "../../shared/sendResponse";
import { BusinessProfileService } from "./businessProfile.service";
import { Types } from "mongoose";

/**
 * Create new business profile with logo upload
 * POST /api/v1/business-profile
 */
const create = catchAsync(async (req: Request, res: Response) => {
  const userId = new Types.ObjectId(req.user?._id);
  const logoFile = (req.files as any)?.image?.[0] as Express.Multer.File | undefined;

  // Use parsed data if available, otherwise use body
  let payload = req.body.data || req.body;
  
  // If payload is a string (from FormData), parse it as JSON
  if (typeof payload === "string") {
    payload = JSON.parse(payload);
  }

  const profile = await BusinessProfileService.createBusinessProfile(
    userId,
    payload,
    logoFile
  );

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: "Business profile created successfully with default branch",
    data: profile,
  });
});

/**
 * Get authenticated user's business profile
 * GET /api/v1/business-profile
 */
const get = catchAsync(async (req: Request, res: Response) => {
  const userId = new Types.ObjectId(req.user?._id);

  const profile = await BusinessProfileService.getBusinessProfile(userId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Business profile retrieved successfully",
    data: profile,
  });
});

/**
 * Update business profile with optional logo update
 * PATCH /api/v1/business-profile
 */
const update = catchAsync(async (req: Request, res: Response) => {
  const userId = new Types.ObjectId(req.user?._id);
  const logoFile = (req.files as any)?.image?.[0] as Express.Multer.File | undefined;

  // Use parsed data if available, otherwise use body
  let payload = req.body.data || req.body;
  
  // If payload is a string (from FormData), parse it as JSON
  if (typeof payload === "string") {
    payload = JSON.parse(payload);
  }

  const profile = await BusinessProfileService.updateBusinessProfile(
    userId,
    payload,
    logoFile
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Business profile updated successfully",
    data: profile,
  });
});

export const BusinessProfileController = {
  create,
  get,
  update,
};
