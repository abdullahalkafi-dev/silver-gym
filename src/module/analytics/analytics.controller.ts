import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { Types } from "mongoose";

import AppError from "../../errors/AppError";
import catchAsync from "../../shared/catchAsync";
import sendResponse from "../../shared/sendResponse";
import { AnalyticsService } from "./analytics.service";

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

const getMemberSummary = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;
  const query = AnalyticsService.parseFilterQuery(req.query as Record<string, unknown>);

  const result = await AnalyticsService.getMemberSummary(branchId, resolveActor(req), query);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Member analytics retrieved successfully",
    data: result,
  });
});

const getFinancialSummary = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;
  const query = AnalyticsService.parseFilterQuery(req.query as Record<string, unknown>);

  const result = await AnalyticsService.getFinancialSummary(branchId, resolveActor(req), query);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Financial analytics retrieved successfully",
    data: result,
  });
});

const getCostSummary = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;
  const query = AnalyticsService.parseFilterQuery(req.query as Record<string, unknown>);

  const result = await AnalyticsService.getCostSummary(branchId, resolveActor(req), query);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Cost analytics retrieved successfully",
    data: result,
  });
});

const getPackagesSummary = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;
  const query = AnalyticsService.parseFilterQuery(req.query as Record<string, unknown>);

  const result = await AnalyticsService.getPackagesSummary(branchId, resolveActor(req), {
    year: query.year,
  });

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Package analytics retrieved successfully",
    data: result,
  });
});

const getCompareSummary = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;
  const query = AnalyticsService.parseCompareQuery(req.query as Record<string, unknown>);

  const result = await AnalyticsService.getCompareSummary(branchId, resolveActor(req), query);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Financial compare analytics retrieved successfully",
    data: result,
  });
});

const getOverviewSummary = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;
  const query = AnalyticsService.parseOverviewQuery(req.query as Record<string, unknown>);

  const result = await AnalyticsService.getOverviewSummary(branchId, resolveActor(req), query);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Overview analytics retrieved successfully",
    data: result,
  });
});

export const AnalyticsController = {
  getMemberSummary,
  getFinancialSummary,
  getCostSummary,
  getPackagesSummary,
  getCompareSummary,
  getOverviewSummary,
};
