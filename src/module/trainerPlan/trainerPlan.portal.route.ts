import { Router } from "express";
import { StatusCodes } from "http-status-codes";

import validateRequest from "@middlewares/validateRequest";
import catchAsync from "../../shared/catchAsync";
import sendResponse from "../../shared/sendResponse";
import authPortal from "../portal/portal.auth";
import { PlanRequestService } from "./planRequest.service";
import { PlanTemplateService } from "./planTemplate.service";
import {
  createPlanRequestDto,
  declineDto,
  replyDto,
  templateDto,
  templateUpdateDto,
  trainerListDto,
} from "./trainerPlan.dto";

/** Mounted inside the portal router (`/api/v1/portal`). See docs/trainer-plans.md. */
const router = Router();

type TMemberAuth = { kind: "member"; memberDbId: string; branchId: string };
type TTrainerAuth = { kind: "trainer"; trainerId: string; branchId: string };

const member = (req: any) => req.portal as TMemberAuth;
const trainer = (req: any) => req.portal as TTrainerAuth;

const noStore = (res: any) => res.setHeader("Cache-Control", "no-store");

/* ─── Member ─────────────────────────────────────────────────────────────────── */

router.get(
  "/plan-trainers",
  authPortal("member"),
  catchAsync(async (req, res) => {
    const data = await PlanRequestService.listTrainersForMember(member(req).branchId);
    noStore(res);
    sendResponse(res, { statusCode: StatusCodes.OK, success: true, data });
  }),
);

router.get(
  "/plan-requests",
  authPortal("member"),
  catchAsync(async (req, res) => {
    const data = await PlanRequestService.listForMember(member(req).memberDbId);
    noStore(res);
    sendResponse(res, { statusCode: StatusCodes.OK, success: true, data });
  }),
);

router.get(
  "/plan-requests/:id",
  authPortal("member"),
  catchAsync(async (req, res) => {
    const data = await PlanRequestService.getForMember(member(req).memberDbId, req.params.id as string);
    noStore(res);
    sendResponse(res, { statusCode: StatusCodes.OK, success: true, data });
  }),
);

router.post(
  "/plan-requests",
  authPortal("member"),
  validateRequest(createPlanRequestDto),
  catchAsync(async (req, res) => {
    const auth = member(req);
    const data = await PlanRequestService.submit(auth.memberDbId, auth.branchId, req.body);
    sendResponse(res, {
      statusCode: StatusCodes.CREATED,
      success: true,
      message: "Your request was sent to the trainer",
      data,
    });
  }),
);

router.delete(
  "/plan-requests/:id",
  authPortal("member"),
  catchAsync(async (req, res) => {
    const data = await PlanRequestService.cancelForMember(member(req).memberDbId, req.params.id as string);
    sendResponse(res, { statusCode: StatusCodes.OK, success: true, message: "Request cancelled", data });
  }),
);

/* ─── Trainer: requests ──────────────────────────────────────────────────────── */

router.get(
  "/trainer/requests",
  authPortal("trainer"),
  validateRequest(trainerListDto),
  catchAsync(async (req, res) => {
    const { items, counts, meta } = await PlanRequestService.listForTrainer(
      trainer(req).trainerId,
      req.query as any,
    );
    noStore(res);
    sendResponse(res, { statusCode: StatusCodes.OK, success: true, meta, data: { items, counts } });
  }),
);

router.get(
  "/trainer/requests/:id",
  authPortal("trainer"),
  catchAsync(async (req, res) => {
    const data = await PlanRequestService.getForTrainer(trainer(req).trainerId, req.params.id as string);
    noStore(res);
    sendResponse(res, { statusCode: StatusCodes.OK, success: true, data });
  }),
);

router.put(
  "/trainer/requests/:id/reply",
  authPortal("trainer"),
  validateRequest(replyDto),
  catchAsync(async (req, res) => {
    const data = await PlanRequestService.saveReply(
      trainer(req).trainerId,
      req.params.id as string,
      req.body,
    );
    sendResponse(res, { statusCode: StatusCodes.OK, success: true, message: "Plan saved", data });
  }),
);

router.post(
  "/trainer/requests/:id/decline",
  authPortal("trainer"),
  validateRequest(declineDto),
  catchAsync(async (req, res) => {
    const data = await PlanRequestService.decline(
      trainer(req).trainerId,
      req.params.id as string,
      req.body.reason,
    );
    sendResponse(res, { statusCode: StatusCodes.OK, success: true, message: "Request declined", data });
  }),
);

/* ─── Trainer: private templates ─────────────────────────────────────────────── */

router.get(
  "/trainer/templates",
  authPortal("trainer"),
  catchAsync(async (req, res) => {
    const data = await PlanTemplateService.list(trainer(req).trainerId);
    noStore(res);
    sendResponse(res, { statusCode: StatusCodes.OK, success: true, data });
  }),
);

router.get(
  "/trainer/templates/:id",
  authPortal("trainer"),
  catchAsync(async (req, res) => {
    const data = await PlanTemplateService.get(trainer(req).trainerId, req.params.id as string);
    noStore(res);
    sendResponse(res, { statusCode: StatusCodes.OK, success: true, data });
  }),
);

router.post(
  "/trainer/templates",
  authPortal("trainer"),
  validateRequest(templateDto),
  catchAsync(async (req, res) => {
    const auth = trainer(req);
    const data = await PlanTemplateService.create(auth.trainerId, auth.branchId, req.body);
    sendResponse(res, { statusCode: StatusCodes.CREATED, success: true, message: "Template saved", data });
  }),
);

router.patch(
  "/trainer/templates/:id",
  authPortal("trainer"),
  validateRequest(templateUpdateDto),
  catchAsync(async (req, res) => {
    const data = await PlanTemplateService.update(
      trainer(req).trainerId,
      req.params.id as string,
      req.body,
    );
    sendResponse(res, { statusCode: StatusCodes.OK, success: true, message: "Template saved", data });
  }),
);

router.delete(
  "/trainer/templates/:id",
  authPortal("trainer"),
  catchAsync(async (req, res) => {
    const data = await PlanTemplateService.remove(trainer(req).trainerId, req.params.id as string);
    sendResponse(res, { statusCode: StatusCodes.OK, success: true, message: "Template deleted", data });
  }),
);

export const TrainerPlanPortalRoutes = router;
