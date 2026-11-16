import { Router } from "express";
import { StatusCodes } from "http-status-codes";
import { Types } from "mongoose";
import { z } from "zod";

import authStaff from "@middlewares/authStaff";
import requirePermission from "@middlewares/requirePermission";
import { authLimiter } from "@middlewares/security";
import validateRequest from "@middlewares/validateRequest";
import AppError from "../../errors/AppError";
import catchAsync from "../../shared/catchAsync";
import sendResponse from "../../shared/sendResponse";
import { resolveBranchActor } from "../../shared/branchAccess";
import { MemberUpdateRequestService } from "./memberUpdateRequest.service";

const router = Router();

const reviewDto = z.object({
  body: z
    .object({
      accept: z.array(z.string()),
      overrides: z.record(z.string(), z.unknown()).optional(),
      note: z.string().trim().max(300).optional(),
    })
    .strict(),
});

// Reading is open to any signed-in staff of the branch (the member page asks on every visit);
// applying or rejecting a request needs the "manage members" permission.
const readGuard = [authStaff({ allowOwner: true })];
const guard = [authStaff({ allowOwner: true }), requirePermission("canManageMembers")];

// Which members of the branch have a request waiting (for list badges)
router.get(
  "/:branchId/pending-members",
  ...readGuard,
  catchAsync(async (req, res) => {
    const branchId = req.params.branchId as string;
    await resolveBranchActor(req, branchId);
    const data = await MemberUpdateRequestService.listPendingMemberIds(branchId);
    sendResponse(res, { statusCode: StatusCodes.OK, success: true, data });
  }),
);

// The waiting request of one member, compared with the live profile
router.get(
  "/:branchId/member/:memberId",
  ...readGuard,
  catchAsync(async (req, res) => {
    const branchId = req.params.branchId as string;
    const memberId = req.params.memberId as string;
    await resolveBranchActor(req, branchId);
    if (!Types.ObjectId.isValid(memberId)) {
      throw new AppError(StatusCodes.BAD_REQUEST, "Invalid member id");
    }
    const data = await MemberUpdateRequestService.getPendingForReview(branchId, memberId);
    sendResponse(res, { statusCode: StatusCodes.OK, success: true, data });
  }),
);

router.post(
  "/:branchId/:requestId/review",
  authLimiter,
  ...guard,
  validateRequest(reviewDto),
  catchAsync(async (req, res) => {
    const branchId = req.params.branchId as string;
    const { actor } = await resolveBranchActor(req, branchId);
    const data = await MemberUpdateRequestService.review(
      branchId,
      req.params.requestId as string,
      actor,
      req.body,
    );
    sendResponse(res, {
      statusCode: StatusCodes.OK,
      success: true,
      message: "Request reviewed",
      data,
    });
  }),
);

export const MemberUpdateRequestRoutes = router;
