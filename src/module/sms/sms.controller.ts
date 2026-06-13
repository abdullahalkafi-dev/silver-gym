import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { Types } from "mongoose";
import AppError from "../../errors/AppError";
import catchAsync from "../../shared/catchAsync";
import sendResponse from "../../shared/sendResponse";
import { SmsService } from "./sms.service";

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

const getBalance = catchAsync(async (req: Request, res: Response) => {
  const businessId = req.params.businessId as string;
  const branchId = req.params.branchId as string;
  const result = await SmsService.getBalance(businessId, branchId, resolveActor(req));

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "SMS balance retrieved successfully",
    data: result,
  });
});

const listDueMembers = catchAsync(async (req: Request, res: Response) => {
  const businessId = req.params.businessId as string;
  const branchId = req.params.branchId as string;
  const result = await SmsService.listDueMembers(businessId, branchId, resolveActor(req), {
    targetDate: req.query.targetDate ? new Date(req.query.targetDate as string) : undefined,
    dueDuration: req.query.dueDuration as
      | "thisMonth"
      | "last2Months"
      | "last3Months"
      | "allDue"
      | undefined,
    page: req.query.page as string | undefined,
    limit: req.query.limit as string | undefined,
    searchTerm: req.query.searchTerm as string | undefined,
  });

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Due SMS recipients retrieved successfully",
    data: result,
  });
});

const preview = catchAsync(async (req: Request, res: Response) => {
  const businessId = req.params.businessId as string;
  const branchId = req.params.branchId as string;
  const payload = req.body.data || req.body;
  const result = await SmsService.previewSms(businessId, branchId, resolveActor(req), payload);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "SMS preview generated successfully",
    data: result,
  });
});

const send = catchAsync(async (req: Request, res: Response) => {
  const businessId = req.params.businessId as string;
  const branchId = req.params.branchId as string;
  const payload = req.body.data || req.body;
  const result = await SmsService.sendSms(businessId, branchId, resolveActor(req), payload);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "SMS request processed successfully",
    data: result,
  });
});

const listHistory = catchAsync(async (req: Request, res: Response) => {
  const businessId = req.params.businessId as string;
  const branchId = req.params.branchId as string;
  const result = await SmsService.listHistory(businessId, branchId, resolveActor(req), {
    page: req.query.page as string | undefined,
    limit: req.query.limit as string | undefined,
    status: req.query.status as string | undefined,
    sendMode: req.query.sendMode as string | undefined,
    searchTerm: req.query.searchTerm as string | undefined,
  });

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "SMS history retrieved successfully",
    data: result,
  });
});

const listMemberHistory = catchAsync(async (req: Request, res: Response) => {
  const businessId = req.params.businessId as string;
  const branchId = req.params.branchId as string;
  const memberId = req.params.memberId as string;
  const result = await SmsService.listMemberHistory(
    businessId,
    branchId,
    memberId,
    resolveActor(req),
    {
      page: req.query.page as string | undefined,
      limit: req.query.limit as string | undefined,
      status: req.query.status as string | undefined,
      sendMode: req.query.sendMode as string | undefined,
      searchTerm: req.query.searchTerm as string | undefined,
    },
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Member SMS history retrieved successfully",
    data: result,
  });
});

export const SmsController = {
  getBalance,
  listDueMembers,
  preview,
  send,
  listHistory,
  listMemberHistory,
};
