import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { Types } from "mongoose";
import AppError from "../../errors/AppError";
import catchAsync from "../../shared/catchAsync";
import sendResponse from "../../shared/sendResponse";
import { IncomeCategoryService } from "./incomeCategory.service";

const resolveActor = (req: Request) => {
  if (req.user?._id) {
    return {
      userId: new Types.ObjectId(req.user._id),
    };
  }

  if (req.staff) {
    return {
      staff: req.staff,
    };
  }

  throw new AppError(StatusCodes.UNAUTHORIZED, "You are not authorized");
};

const createCategory = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;
  const actor = resolveActor(req);
  const result = await IncomeCategoryService.createCategory(
    branchId,
    actor,
    req.body,
  );

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: "Income category created successfully",
    data: result,
  });
});

const getCategories = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;
  const includeInactive = req.query.includeInactive === "true";
  const result = await IncomeCategoryService.getCategories(
    branchId,
    includeInactive,
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Income categories retrieved successfully",
    data: result,
  });
});

const updateCategory = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;
  const categoryId = req.params.categoryId as string;
  const actor = resolveActor(req);
  const result = await IncomeCategoryService.updateCategory(
    branchId,
    categoryId,
    actor,
    req.body,
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Income category updated successfully",
    data: result,
  });
});

const deleteCategory = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;
  const categoryId = req.params.categoryId as string;
  const actor = resolveActor(req);
  const result = await IncomeCategoryService.deleteCategory(
    branchId,
    categoryId,
    actor,
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Income category deactivated successfully",
    data: result,
  });
});

export const IncomeCategoryController = {
  createCategory,
  getCategories,
  updateCategory,
  deleteCategory,
};
