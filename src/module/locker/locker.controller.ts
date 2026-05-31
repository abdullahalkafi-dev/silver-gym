import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { Types } from "mongoose";

import AppError from "../../errors/AppError";
import catchAsync from "../../shared/catchAsync";
import sendResponse from "../../shared/sendResponse";
import { LockerService } from "./locker.service";

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

// ─── Get Locker Fee ─────────────────────────────────────────────────────────

const getLockerFee = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;

  const branch = await (await import("../branch/branch.repository")).BranchRepository.findById(branchId);
  if (!branch) {
    throw new AppError(StatusCodes.NOT_FOUND, "Branch not found");
  }

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Locker fee retrieved successfully",
    data: {
      branchId: String(branch._id),
      branchName: branch.branchName,
      lockerFeeAmount: branch.lockerFeeAmount || 0,
    },
  });
});

// ─── Create Lockers ─────────────────────────────────────────────────────────

const createLockers = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;
  const payload = req.body.data || req.body;

  const result = await LockerService.createLockers(
    branchId,
    resolveActor(req),
    payload.count,
  );

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: `${payload.count} locker(s) created successfully`,
    data: result,
  });
});

// ─── Get Lockers ────────────────────────────────────────────────────────────

const getLockers = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;
  const { status, search } = req.query;

  const result = await LockerService.getLockers(branchId, {
    status: status as any,
    search: search as string,
  });

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Lockers retrieved successfully",
    data: result,
  });
});

// ─── Get Single Locker ──────────────────────────────────────────────────────

const getLockerById = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;
  const lockerId = req.params.lockerId as string;

  const result = await LockerService.getLockerById(branchId, lockerId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Locker retrieved successfully",
    data: result,
  });
});

// ─── Update Locker ──────────────────────────────────────────────────────────

const updateLocker = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;
  const lockerId = req.params.lockerId as string;
  const payload = req.body.data || req.body;

  const result = await LockerService.updateLocker(
    branchId,
    lockerId,
    resolveActor(req),
    payload,
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Locker updated successfully",
    data: result,
  });
});

// ─── Set Branch Locker Price ────────────────────────────────────────────────

const setBranchLockerPrice = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;
  const payload = req.body.data || req.body;

  const result = await LockerService.setBranchLockerPrice(
    branchId,
    resolveActor(req),
    payload.price,
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Default locker price updated successfully",
    data: result,
  });
});

// ─── Set Custom Locker Price ────────────────────────────────────────────────

const setCustomLockerPrice = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;
  const lockerId = req.params.lockerId as string;
  const payload = req.body.data || req.body;

  const result = await LockerService.setCustomLockerPrice(
    branchId,
    lockerId,
    resolveActor(req),
    payload.price,
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Custom locker price set successfully",
    data: result,
  });
});

// ─── Reset To System Price ──────────────────────────────────────────────────

const resetToSystemPrice = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;
  const lockerId = req.params.lockerId as string;

  const result = await LockerService.resetToSystemPrice(
    branchId,
    lockerId,
    resolveActor(req),
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Locker reset to system price successfully",
    data: result,
  });
});

// ─── Assign Member ──────────────────────────────────────────────────────────

const assignMember = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;
  const lockerId = req.params.lockerId as string;
  const payload = req.body.data || req.body;

  const result = await LockerService.assignMember(
    branchId,
    lockerId,
    resolveActor(req),
    payload,
  );

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: "Member assigned to locker successfully",
    data: result,
  });
});

// ─── Collect Locker Payment ─────────────────────────────────────────────────

const collectLockerPayment = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;
  const lockerId = req.params.lockerId as string;
  const payload = req.body.data || req.body;

  const result = await LockerService.collectLockerPayment(
    branchId,
    lockerId,
    resolveActor(req),
    payload,
  );

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: "Locker payment collected successfully",
    data: result,
  });
});

// ─── Unassign Member ────────────────────────────────────────────────────────

const unassignMember = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;
  const lockerId = req.params.lockerId as string;

  const result = await LockerService.unassignMember(
    branchId,
    lockerId,
    resolveActor(req),
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Member unassigned from locker successfully",
    data: result,
  });
});

// ─── Delete Locker ──────────────────────────────────────────────────────────

const deleteLocker = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;
  const lockerId = req.params.lockerId as string;

  const result = await LockerService.deleteLocker(branchId, lockerId, resolveActor(req));

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Locker deleted successfully",
    data: result,
  });
});

// ─── Get Locker Stats ───────────────────────────────────────────────────────

const getLockerStats = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;

  const result = await LockerService.getLockerStats(branchId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Locker stats retrieved successfully",
    data: result,
  });
});

// ─── Get Locker Payment History ─────────────────────────────────────────────

const getLockerPaymentHistory = catchAsync(
  async (req: Request, res: Response) => {
    const branchId = req.params.branchId as string;
    const lockerId = req.params.lockerId as string;

    const result = await LockerService.getLockerPaymentHistory(branchId, lockerId);

    sendResponse(res, {
      statusCode: StatusCodes.OK,
      success: true,
      message: "Locker payment history retrieved successfully",
      data: result,
    });
  },
);

export const LockerController = {
  getLockerFee,
  createLockers,
  getLockers,
  getLockerById,
  updateLocker,
  setBranchLockerPrice,
  setCustomLockerPrice,
  resetToSystemPrice,
  assignMember,
  collectLockerPayment,
  unassignMember,
  deleteLocker,
  getLockerStats,
  getLockerPaymentHistory,
};
