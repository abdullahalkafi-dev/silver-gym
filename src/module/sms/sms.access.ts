import { NextFunction, Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import AppError from "../../errors/AppError";

const isAdminRoleName = (roleName?: string) =>
  Boolean(roleName?.trim().toLowerCase().includes("admin"));

/** Owner, or a staff member whose role is an admin role. */
export const isSmsAdmin = (req: Request) =>
  Boolean(req.user) || isAdminRoleName(req.staffAuth?.roleName);

/** SMS pages and sending: the owner, an admin role, or staff with the "Can send SMS" permission. */
export const requireSmsAccess = (req: Request, _res: Response, next: NextFunction) => {
  if (isSmsAdmin(req) || req.staffPermissions?.canSendSms) {
    return next();
  }
  next(new AppError(StatusCodes.FORBIDDEN, "You do not have permission to use SMS"));
};

/** Master switch, automatic messages, sender name, test messages: owner or admin only. */
export const requireSmsAdmin = (req: Request, _res: Response, next: NextFunction) => {
  if (isSmsAdmin(req)) {
    return next();
  }
  next(new AppError(StatusCodes.FORBIDDEN, "Only the owner or an admin can change SMS settings"));
};
