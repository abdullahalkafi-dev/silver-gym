import { Router } from "express";
import { StatusCodes } from "http-status-codes";

import authStaff from "@middlewares/authStaff";
import requirePermission from "@middlewares/requirePermission";
import validateRequest from "@middlewares/validateRequest";
import catchAsync from "../../shared/catchAsync";
import sendResponse from "../../shared/sendResponse";
import { resolveBranchActor } from "../../shared/branchAccess";
import { PlanRequestService } from "./planRequest.service";
import { staffListDto } from "./trainerPlan.dto";

/**
 * Dashboard, read only: owner and staff follow what members asked and what trainers answered.
 * Same guard as the Trainers page. Mounted at `/api/v1/trainer-plans`.
 */
const router = Router();

const guard = [authStaff({ allowOwner: true }), requirePermission("canManageMembers")];

// Request counts per trainer of the branch (for the Trainers list)
router.get(
  "/:branchId/summary",
  ...guard,
  catchAsync(async (req, res) => {
    const branchId = req.params.branchId as string;
    await resolveBranchActor(req, branchId);
    const data = await PlanRequestService.branchSummary(branchId);
    sendResponse(res, { statusCode: StatusCodes.OK, success: true, data });
  }),
);

// One trainer's requests and replies, with filters
router.get(
  "/:branchId/trainer/:trainerId/requests",
  ...guard,
  validateRequest(staffListDto),
  catchAsync(async (req, res) => {
    const branchId = req.params.branchId as string;
    await resolveBranchActor(req, branchId);
    const { meta, ...data } = await PlanRequestService.listForStaff(
      branchId,
      req.params.trainerId as string,
      req.query as any,
    );
    sendResponse(res, { statusCode: StatusCodes.OK, success: true, meta, data });
  }),
);

export const TrainerPlanRoutes = router;
