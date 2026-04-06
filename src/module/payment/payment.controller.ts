import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { Types } from "mongoose";

import AppError from "../../errors/AppError";
import catchAsync from "../../shared/catchAsync";
import sendResponse from "../../shared/sendResponse";
import { PaymentService } from "./payment.service";

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
  const payload = req.body.data || req.body;

  const result = await PaymentService.createPayment(
    branchId,
    resolveActor(req),
    payload,
  );

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: "Payment created successfully",
    data: result,
  });
});

const getAll = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;

  const result = await PaymentService.getAllPayments(
    branchId,
    resolveActor(req),
    req.query as Record<string, unknown>,
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Payments retrieved successfully",
    meta: result.meta,
    data: result.result,
  });
});

const getById = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;
  const paymentId = req.params.paymentId as string;

  const result = await PaymentService.getPaymentById(
    branchId,
    paymentId,
    resolveActor(req),
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Payment retrieved successfully",
    data: result,
  });
});

const update = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;
  const paymentId = req.params.paymentId as string;
  const payload = req.body.data || req.body;

  const result = await PaymentService.updatePayment(
    branchId,
    paymentId,
    resolveActor(req),
    payload,
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Payment updated successfully",
    data: result,
  });
});

const cancel = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;
  const paymentId = req.params.paymentId as string;

  const result = await PaymentService.cancelPayment(
    branchId,
    paymentId,
    resolveActor(req),
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Payment cancelled successfully",
    data: result,
  });
});

const refund = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;
  const paymentId = req.params.paymentId as string;

  const result = await PaymentService.refundPayment(
    branchId,
    paymentId,
    resolveActor(req),
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Payment refunded successfully",
    data: result,
  });
});

export const PaymentController = {
  create,
  getAll,
  getById,
  update,
  cancel,
  refund,
};
