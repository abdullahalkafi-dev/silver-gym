import { NextFunction, Request, Response } from "express";
import { StatusCodes } from "http-status-codes";

import { TStaffPermissionKey } from "module/auth/auth.util";
import AppError from "../errors/AppError";

const requirePermission = (permission: TStaffPermissionKey) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (req.user) {
      return next();
    }

    if (!req.staff) {
      throw new AppError(StatusCodes.UNAUTHORIZED, "You are not authorized");
    }

    if (!req.staffPermissions?.[permission]) {
      throw new AppError(
        StatusCodes.FORBIDDEN,
        "You do not have permission to access this resource",
      );
    }

    next();
  };
};

export default requirePermission;
