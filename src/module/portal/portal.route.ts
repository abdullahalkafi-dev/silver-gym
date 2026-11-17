import { Router } from "express";
import { StatusCodes } from "http-status-codes";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";

import validateRequest from "@middlewares/validateRequest";
import AppError from "../../errors/AppError";
import catchAsync from "../../shared/catchAsync";
import sendResponse from "../../shared/sendResponse";
import unlinkFile from "../../shared/unlinkFile";
import { MemberUpdateRequestService } from "../memberUpdateRequest/memberUpdateRequest.service";
import { TrainerPlanPortalRoutes } from "../trainerPlan/trainerPlan.portal.route";
import authPortal from "./portal.auth";
import { PortalService } from "./portal.service";
import portalPhotoUpload from "./portal.upload";

const router = Router();

// Failed sign-ins only: 10 tries per 15 minutes per IP.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many attempts. Please try again in a few minutes.",
  },
});

const memberLoginDto = z.object({
  body: z
    .object({
      memberId: z.string().trim().min(1, "Member ID is required").max(30),
      phone: z.string().trim().min(1, "Phone number is required").max(20),
    })
    .strict(),
});

const trainerLoginDto = z.object({
  body: z
    .object({
      username: z.string().trim().min(1, "Username is required").max(50),
      password: z.string().min(1, "Password is required").max(100),
    })
    .strict(),
});

router.post(
  "/auth/member-login",
  loginLimiter,
  validateRequest(memberLoginDto),
  catchAsync(async (req, res) => {
    const data = await PortalService.memberLogin(req.body);
    sendResponse(res, { statusCode: StatusCodes.OK, success: true, message: "Signed in", data });
  }),
);

router.post(
  "/auth/trainer-login",
  loginLimiter,
  validateRequest(trainerLoginDto),
  catchAsync(async (req, res) => {
    const data = await PortalService.trainerLogin(req.body);
    sendResponse(res, { statusCode: StatusCodes.OK, success: true, message: "Signed in", data });
  }),
);

// Who am I (member or trainer)
router.get(
  "/me",
  authPortal(),
  catchAsync(async (req, res) => {
    const auth = req.portal!;
    const data =
      auth.kind === "member"
        ? await PortalService.getMemberMe(auth.memberDbId, auth.branchId)
        : await PortalService.getTrainerMe(auth.trainerId);
    res.setHeader("Cache-Control", "no-store");
    sendResponse(res, { statusCode: StatusCodes.OK, success: true, data });
  }),
);

// ---- member only ----

router.get(
  "/payments",
  authPortal("member"),
  catchAsync(async (req, res) => {
    const auth = req.portal as { kind: "member"; memberDbId: string };
    const data = await PortalService.getMemberPayments(auth.memberDbId);
    res.setHeader("Cache-Control", "no-store");
    sendResponse(res, { statusCode: StatusCodes.OK, success: true, data });
  }),
);

router.get(
  "/update-request",
  authPortal("member"),
  catchAsync(async (req, res) => {
    const auth = req.portal as { kind: "member"; memberDbId: string };
    const data = await MemberUpdateRequestService.getForMember(auth.memberDbId);
    res.setHeader("Cache-Control", "no-store");
    sendResponse(res, { statusCode: StatusCodes.OK, success: true, data });
  }),
);

// multipart: `data` (JSON string of the fields to change) + optional `image`
router.post(
  "/update-request",
  authPortal("member"),
  portalPhotoUpload,
  catchAsync(async (req, res) => {
    const auth = req.portal as { kind: "member"; memberDbId: string };
    const photoKey = (req as any).pendingPhotoKey as string | undefined;

    let fields: unknown = req.body?.data ?? req.body ?? {};
    if (typeof fields === "string") {
      try {
        fields = JSON.parse(fields);
      } catch {
        if (photoKey) await unlinkFile(photoKey);
        throw new AppError(StatusCodes.BAD_REQUEST, "Invalid request data");
      }
    }

    const data = await MemberUpdateRequestService.submit(auth.memberDbId, fields, photoKey);
    sendResponse(res, {
      statusCode: StatusCodes.OK,
      success: true,
      message: "Your update request was sent for review",
      data,
    });
  }),
);

router.delete(
  "/update-request",
  authPortal("member"),
  catchAsync(async (req, res) => {
    const auth = req.portal as { kind: "member"; memberDbId: string };
    const data = await MemberUpdateRequestService.cancelForMember(auth.memberDbId);
    sendResponse(res, {
      statusCode: StatusCodes.OK,
      success: true,
      message: "Request cancelled",
      data,
    });
  }),
);

// "Ask a trainer": member requests, trainer inbox and templates (docs/trainer-plans.md)
router.use(TrainerPlanPortalRoutes);

export const PortalRoutes = router;
