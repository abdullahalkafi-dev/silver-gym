import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { Types } from "mongoose";

import AppError from "../../errors/AppError";
import catchAsync from "../../shared/catchAsync";
import sendResponse from "../../shared/sendResponse";
import { PackageService } from "./package.service";

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

const create = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;
  const payload = req.body?.data || req.body;

  const result = await PackageService.createPackage(
    branchId,
    resolveActor(req),
    payload,
  );

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: "Package created successfully",
    data: result,
  });
});

const getAll = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;

  const result = await PackageService.getAllPackages(
    branchId,
    resolveActor(req),
    req.query as Record<string, unknown>,
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Packages retrieved successfully",
    meta: result.meta,
    data: result.result,
  });
});

const getById = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;
  const packageId = req.params.packageId as string;

  const result = await PackageService.getPackageById(
    branchId,
    packageId,
    resolveActor(req),
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Package retrieved successfully",
    data: result,
  });
});

const update = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;
  const packageId = req.params.packageId as string;
  const payload = req.body?.data || req.body;

  const result = await PackageService.updatePackage(
    branchId,
    packageId,
    resolveActor(req),
    payload,
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Package updated successfully",
    data: result,
  });
});

const remove = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;
  const packageId = req.params.packageId as string;

  const result = await PackageService.deletePackage(
    branchId,
    packageId,
    resolveActor(req),
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Package deleted successfully",
    data: result,
  });
});

const restore = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;
  const packageId = req.params.packageId as string;

  const result = await PackageService.restorePackage(
    branchId,
    packageId,
    resolveActor(req),
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Package restored successfully",
    data: result,
  });
});

export const PackageController = {
  create,
  getAll,
  getById,
  update,
  remove,
  restore,
};
