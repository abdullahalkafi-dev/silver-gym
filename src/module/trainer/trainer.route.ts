import { Router } from "express";
import { z } from "zod";
import { StatusCodes } from "http-status-codes";

import authStaff from "@middlewares/authStaff";
import requirePermission from "@middlewares/requirePermission";
import { authLimiter } from "@middlewares/security";
import validateRequest from "@middlewares/validateRequest";
import catchAsync from "../../shared/catchAsync";
import sendResponse from "../../shared/sendResponse";
import { resolveBranchActor } from "../../shared/branchAccess";
import { TrainerService } from "./trainer.service";

const router = Router();

const createDto = z.object({
  body: z
    .object({
      username: z.string().trim().min(3),
      displayName: z.string().trim().min(1, "Name is required"),
      phone: z.string().trim().optional(),
      password: z.string().min(6, "Password must be at least 6 characters"),
    })
    .strict(),
});

const updateDto = z.object({
  body: z
    .object({
      displayName: z.string().trim().min(1).optional(),
      phone: z.string().trim().optional(),
      isActive: z.boolean().optional(),
      password: z.string().min(6, "Password must be at least 6 characters").optional(),
    })
    .strict(),
});

const guard = [authStaff({ allowOwner: true }), requirePermission("canManageMembers")];

// GET /trainers/check-username?username=x
router.get(
  "/check-username",
  ...guard,
  catchAsync(async (req, res) => {
    const data = await TrainerService.checkUsername(String(req.query.username ?? ""));
    sendResponse(res, { statusCode: StatusCodes.OK, success: true, data });
  }),
);

router.get(
  "/:branchId",
  ...guard,
  catchAsync(async (req, res) => {
    const branchId = req.params.branchId as string;
    await resolveBranchActor(req, branchId);
    const data = await TrainerService.list(branchId);
    sendResponse(res, { statusCode: StatusCodes.OK, success: true, data });
  }),
);

router.post(
  "/:branchId",
  authLimiter,
  ...guard,
  validateRequest(createDto),
  catchAsync(async (req, res) => {
    const branchId = req.params.branchId as string;
    await resolveBranchActor(req, branchId);
    const data = await TrainerService.create(branchId, req.body);
    sendResponse(res, {
      statusCode: StatusCodes.CREATED,
      success: true,
      message: "Trainer created successfully",
      data,
    });
  }),
);

router.patch(
  "/:branchId/:trainerId",
  authLimiter,
  ...guard,
  validateRequest(updateDto),
  catchAsync(async (req, res) => {
    const branchId = req.params.branchId as string;
    await resolveBranchActor(req, branchId);
    const data = await TrainerService.update(
      branchId,
      req.params.trainerId as string,
      req.body,
    );
    sendResponse(res, {
      statusCode: StatusCodes.OK,
      success: true,
      message: "Trainer updated successfully",
      data,
    });
  }),
);

router.delete(
  "/:branchId/:trainerId",
  authLimiter,
  ...guard,
  catchAsync(async (req, res) => {
    const branchId = req.params.branchId as string;
    await resolveBranchActor(req, branchId);
    const data = await TrainerService.remove(branchId, req.params.trainerId as string);
    sendResponse(res, {
      statusCode: StatusCodes.OK,
      success: true,
      message: "Trainer deleted successfully",
      data,
    });
  }),
);

export const TrainerRoutes = router;
