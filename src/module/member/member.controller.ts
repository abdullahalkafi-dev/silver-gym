import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { Types } from "mongoose";

import AppError from "../../errors/AppError";
import catchAsync from "../../shared/catchAsync";
import sendResponse from "../../shared/sendResponse";
import { MemberImportService } from "./memberImport.service";
import { MemberService } from "./member.service";

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
  const photoFile = (req.files as any)?.image?.[0] as Express.Multer.File | undefined;

  const result = await MemberService.createMember(
    branchId,
    resolveActor(req),
    payload,
    photoFile,
  );

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: "Member created successfully",
    data: result,
  });
});

const getAll = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;

  const result = await MemberService.getMembers(
    branchId,
    resolveActor(req),
    req.query as Record<string, unknown>,
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Members retrieved successfully",
    data: result,
  });
});

const getById = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;
  const memberId = req.params.memberId as string;

  const includeInactive =
    typeof req.query.includeInactive === "string" && req.query.includeInactive === "true";

  const result = await MemberService.getMemberById(
    branchId,
    memberId,
    resolveActor(req),
    includeInactive,
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Member retrieved successfully",
    data: result,
  });
});

const update = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;
  const memberId = req.params.memberId as string;
  const payload = req.body.data || req.body;
  const photoFile = (req.files as any)?.image?.[0] as Express.Multer.File | undefined;

  const result = await MemberService.updateMember(
    branchId,
    memberId,
    resolveActor(req),
    payload,
    photoFile,
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Member updated successfully",
    data: result,
  });
});

const remove = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;
  const memberId = req.params.memberId as string;

  const result = await MemberService.deleteMember(
    branchId,
    memberId,
    resolveActor(req),
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Member deleted successfully",
    data: result,
  });
});

const restore = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;
  const memberId = req.params.memberId as string;

  const result = await MemberService.restoreMember(
    branchId,
    memberId,
    resolveActor(req),
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Member restored successfully",
    data: result,
  });
});

const startGoogleSheetImport = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;
  const payload = req.body.data || req.body;

  const batch = await MemberImportService.startGoogleSheetImport(
    branchId,
    resolveActor(req),
    payload,
  );

  sendResponse(res, {
    statusCode: StatusCodes.ACCEPTED,
    success: true,
    message: "Member import started successfully",
    data: batch,
  });
});

const startCSVImport = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;
  const csvFile = (req.files as any)?.csv?.[0] as Express.Multer.File | undefined;

  if (!csvFile) {
    throw new AppError(StatusCodes.BAD_REQUEST, "CSV file is required");
  }

  const batch = await MemberImportService.startCSVImport(
    branchId,
    resolveActor(req),
    csvFile,
  );

  sendResponse(res, {
    statusCode: StatusCodes.ACCEPTED,
    success: true,
    message: "CSV import started successfully",
    data: batch,
  });
});

const getImportBatchStatus = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;
  const batchId = req.params.batchId as string;

  const batch = await MemberImportService.getImportBatchById(
    branchId,
    batchId,
    resolveActor(req),
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Import batch status retrieved successfully",
    data: batch,
  });
});

const listImportBatches = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;

  const result = await MemberImportService.listImportBatches(
    branchId,
    resolveActor(req),
    req.query,
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Import batches retrieved successfully",
    data: result,
  });
});

const getImportMetrics = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;

  const result = await MemberImportService.getImportMetrics(
    branchId,
    resolveActor(req),
    req.query,
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Import metrics retrieved successfully",
    data: result,
  });
});

const getDashboardSummary = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;
  const actor = resolveActor(req);

  const [memberSummary, importMetrics] = await Promise.all([
    MemberService.getDashboardMemberSummary(branchId, actor, req.query),
    MemberImportService.getImportMetrics(branchId, actor, req.query),
  ]);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Dashboard summary retrieved successfully",
    data: {
      members: memberSummary,
      imports: importMetrics,
    },
  });
});

const retryImportBatch = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;
  const batchId = req.params.batchId as string;

  const batch = await MemberImportService.retryFailedRows(
    branchId,
    batchId,
    resolveActor(req),
  );

  sendResponse(res, {
    statusCode: StatusCodes.ACCEPTED,
    success: true,
    message: "Failed rows retry started successfully",
    data: batch,
  });
});

const cancelImportBatch = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;
  const batchId = req.params.batchId as string;

  const batch = await MemberImportService.requestCancelImport(
    branchId,
    batchId,
    resolveActor(req),
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Import cancellation requested successfully",
    data: batch,
  });
});

export const MemberController = {
  create,
  getAll,
  getById,
  update,
  remove,
  restore,
  startGoogleSheetImport,
  startCSVImport,
  listImportBatches,
  getImportMetrics,
  getDashboardSummary,
  getImportBatchStatus,
  retryImportBatch,
  cancelImportBatch,
};
