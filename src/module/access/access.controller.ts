import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { Types } from "mongoose";

import AppError from "../../errors/AppError";
import catchAsync from "../../shared/catchAsync";
import sendResponse from "../../shared/sendResponse";
import { getDhakaDateString } from "../../utils/dhakaTime";
import { AccessService, TAccessActor } from "./access.service";

const resolveActor = (req: Request): TAccessActor => {
  if (req.user?._id) {
    return { userId: new Types.ObjectId(req.user._id) };
  }

  if (req.staff) {
    return {
      staff: req.staff as unknown as {
        _id: string;
        branchId?: string;
        isActive?: boolean;
      },
    };
  }

  throw new AppError(StatusCodes.UNAUTHORIZED, "You are not authorized");
};

const respond =
  (message: string, handler: (req: Request) => Promise<unknown>) =>
  catchAsync(async (req: Request, res: Response) => {
    const data = await handler(req);

    sendResponse(res, {
      statusCode: StatusCodes.OK,
      success: true,
      message,
      data,
    });
  });

const branchId = (req: Request) => req.params.branchId as string;
const body = (req: Request) => req.body.data || req.body;

export const AccessController = {
  getSettings: respond("Access control settings retrieved", (req) =>
    AccessService.getSettings(branchId(req), resolveActor(req)),
  ),
  updateSettings: respond("Access control settings updated", (req) =>
    AccessService.updateSettings(branchId(req), resolveActor(req), body(req)),
  ),
  getIdHealth: respond("Member ID check completed", (req) =>
    AccessService.getIdHealth(branchId(req), resolveActor(req)),
  ),
  getPreview: respond("Access preview retrieved", (req) =>
    AccessService.getAccessPreview(branchId(req), resolveActor(req)),
  ),
  listDevices: respond("Devices retrieved", (req) =>
    AccessService.listDevices(branchId(req), resolveActor(req)),
  ),
  createDevice: respond("Device created", (req) =>
    AccessService.createDevice(branchId(req), resolveActor(req), body(req)),
  ),
  updateDevice: respond("Device updated", (req) =>
    AccessService.updateDevice(
      branchId(req),
      req.params.deviceId as string,
      resolveActor(req),
      body(req),
    ),
  ),
  testDevice: respond("Device connection tested", (req) =>
    AccessService.testDevice(
      branchId(req),
      req.params.deviceId as string,
      resolveActor(req),
    ),
  ),
  syncDevice: respond("Device logs synced", (req) =>
    AccessService.syncDeviceNow(
      branchId(req),
      req.params.deviceId as string,
      resolveActor(req),
    ),
  ),
  getMemberAttendance: respond("Member attendance retrieved", (req) =>
    AccessService.getMemberAttendance(
      branchId(req),
      req.params.memberId as string,
      (req.query.month as string) || getDhakaDateString().slice(0, 7),
      resolveActor(req),
    ),
  ),
  getDayAttendance: respond("Attendance retrieved", (req) =>
    AccessService.getDayAttendance(
      branchId(req),
      (req.query.date as string) || getDhakaDateString(),
      resolveActor(req),
    ),
  ),
  getDeviceAccessPlan: respond("Door access plan retrieved", (req) =>
    AccessService.getDeviceAccessPlan(
      branchId(req),
      req.params.deviceId as string,
      resolveActor(req),
    ),
  ),
  syncDeviceAccess: respond("Door access synced", (req) =>
    AccessService.syncDeviceAccessNow(
      branchId(req),
      req.params.deviceId as string,
      resolveActor(req),
      body(req) ?? {},
    ),
  ),
  testUserState: respond("Test user updated", (req) =>
    AccessService.testUserState(
      branchId(req),
      req.params.deviceId as string,
      resolveActor(req),
      body(req),
    ),
  ),
  releaseAll: respond("Everyone released", (req) =>
    AccessService.releaseAllOnDevice(
      branchId(req),
      req.params.deviceId as string,
      resolveActor(req),
    ),
  ),
  setMemberOverride: respond("Member access override updated", (req) =>
    AccessService.setMemberOverride(
      branchId(req),
      req.params.memberId as string,
      resolveActor(req),
      body(req),
    ),
  ),
};
