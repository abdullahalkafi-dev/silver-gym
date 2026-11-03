import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { Types } from "mongoose";
import AppError from "../../errors/AppError";
import catchAsync from "../../shared/catchAsync";
import sendResponse from "../../shared/sendResponse";
import { isSmsAdmin } from "./sms.access";
import { SmsService, TSmsActor } from "./sms.service";

const resolveActor = (req: Request): TSmsActor => {
  if (req.user?._id) {
    return { userId: new Types.ObjectId(req.user._id), isAdmin: true };
  }
  if (req.staff) {
    return { staff: req.staff, isAdmin: isSmsAdmin(req) };
  }
  throw new AppError(StatusCodes.UNAUTHORIZED, "You are not authorized");
};

const ids = (req: Request) => ({
  businessId: req.params.businessId as string,
  branchId: req.params.branchId as string,
});

const payloadOf = (req: Request) => req.body.data || req.body;

const respond = (res: Response, message: string, data: unknown) =>
  sendResponse(res, { statusCode: StatusCodes.OK, success: true, message, data });

const historyQuery = (req: Request) => ({
  page: req.query.page as string | undefined,
  limit: req.query.limit as string | undefined,
  status: req.query.status as string | undefined,
  templateKey: req.query.templateKey as string | undefined,
  requestId: req.query.requestId as string | undefined,
  searchTerm: req.query.searchTerm as string | undefined,
});

const getBalance = catchAsync(async (req: Request, res: Response) => {
  const { businessId, branchId } = ids(req);
  respond(res, "SMS balance retrieved successfully", await SmsService.getBalance(businessId, branchId, resolveActor(req)));
});

const getSettings = catchAsync(async (req: Request, res: Response) => {
  const { businessId, branchId } = ids(req);
  respond(res, "SMS settings retrieved successfully", await SmsService.getSettings(businessId, branchId, resolveActor(req)));
});

const updateSettings = catchAsync(async (req: Request, res: Response) => {
  const { businessId, branchId } = ids(req);
  respond(
    res,
    "SMS settings updated successfully",
    await SmsService.updateSettings(businessId, branchId, resolveActor(req), payloadOf(req)),
  );
});

const listDueMembers = catchAsync(async (req: Request, res: Response) => {
  const { businessId, branchId } = ids(req);
  respond(
    res,
    "Due members retrieved successfully",
    await SmsService.listDueMembers(businessId, branchId, resolveActor(req), {
      targetDate: req.query.targetDate ? new Date(req.query.targetDate as string) : undefined,
      dueDuration: req.query.dueDuration as never,
    }),
  );
});

const preview = catchAsync(async (req: Request, res: Response) => {
  const { businessId, branchId } = ids(req);
  respond(
    res,
    "SMS preview generated successfully",
    await SmsService.previewSms(businessId, branchId, resolveActor(req), payloadOf(req)),
  );
});

const send = catchAsync(async (req: Request, res: Response) => {
  const { businessId, branchId } = ids(req);
  respond(
    res,
    "SMS request processed successfully",
    await SmsService.sendSms(businessId, branchId, resolveActor(req), payloadOf(req)),
  );
});

const sendTest = catchAsync(async (req: Request, res: Response) => {
  const { businessId, branchId } = ids(req);
  respond(
    res,
    "Test message processed",
    await SmsService.sendTest(businessId, branchId, resolveActor(req), payloadOf(req)),
  );
});

const listHolidays = catchAsync(async (req: Request, res: Response) => {
  const { businessId, branchId } = ids(req);
  respond(res, "Holiday notices retrieved successfully", await SmsService.listHolidays(businessId, branchId, resolveActor(req)));
});

const createHoliday = catchAsync(async (req: Request, res: Response) => {
  const { businessId, branchId } = ids(req);
  respond(
    res,
    "Holiday notice saved",
    await SmsService.createHoliday(businessId, branchId, resolveActor(req), payloadOf(req)),
  );
});

const deleteHoliday = catchAsync(async (req: Request, res: Response) => {
  const { businessId, branchId } = ids(req);
  respond(
    res,
    "Holiday notice deleted",
    await SmsService.deleteHoliday(businessId, branchId, resolveActor(req), req.params.holidayId as string),
  );
});

const listHistory = catchAsync(async (req: Request, res: Response) => {
  const { businessId, branchId } = ids(req);
  respond(
    res,
    "SMS history retrieved successfully",
    await SmsService.listHistory(businessId, branchId, resolveActor(req), historyQuery(req)),
  );
});

const listBatches = catchAsync(async (req: Request, res: Response) => {
  const { businessId, branchId } = ids(req);
  respond(
    res,
    "SMS batches retrieved successfully",
    await SmsService.listBatches(businessId, branchId, resolveActor(req), historyQuery(req)),
  );
});

const listMemberHistory = catchAsync(async (req: Request, res: Response) => {
  const { businessId, branchId } = ids(req);
  respond(
    res,
    "Member SMS history retrieved successfully",
    await SmsService.listHistory(
      businessId,
      branchId,
      resolveActor(req),
      historyQuery(req),
      req.params.memberId as string,
    ),
  );
});

const retryFailed = catchAsync(async (req: Request, res: Response) => {
  const { businessId, branchId } = ids(req);
  respond(
    res,
    "Retry processed",
    await SmsService.retryFailed(businessId, branchId, resolveActor(req), req.params.requestId as string),
  );
});

export const SmsController = {
  getBalance,
  getSettings,
  updateSettings,
  listDueMembers,
  preview,
  send,
  sendTest,
  listHolidays,
  createHoliday,
  deleteHoliday,
  listHistory,
  listBatches,
  listMemberHistory,
  retryFailed,
};
