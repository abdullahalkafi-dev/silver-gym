import { Request } from "express";
import { StatusCodes } from "http-status-codes";
import { Types } from "mongoose";

import AppError from "../errors/AppError";
import { BranchRepository } from "../module/branch/branch.repository";
import { BusinessProfileRepository } from "../module/businessProfile/businessProfile.repository";
import { TStaff } from "../module/staff/staff.interface";

export type TBranchActor = {
  userId?: Types.ObjectId;
  staff?: TStaff;
};

/**
 * Dashboard guard: the caller (business owner or staff) must belong to the branch.
 * Returns the active branch plus the actor shape the member service expects.
 */
export const resolveBranchActor = async (req: Request, branchId: string) => {
  if (!Types.ObjectId.isValid(branchId)) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Invalid branch id");
  }

  const branch = await BranchRepository.findOne({
    _id: new Types.ObjectId(branchId),
    isActive: true,
  });

  if (!branch) {
    throw new AppError(StatusCodes.NOT_FOUND, "Branch not found");
  }

  if (req.user?._id) {
    const userId = new Types.ObjectId(String(req.user._id));
    const business = await BusinessProfileRepository.findOne({
      _id: branch.businessId,
      userId,
    });

    if (!business) {
      throw new AppError(
        StatusCodes.FORBIDDEN,
        "You do not have permission to access this branch",
      );
    }

    return { branch, actor: { userId } as TBranchActor };
  }

  if (req.staff) {
    if (!req.staff.isActive || String(req.staff.branchId) !== String(branch._id)) {
      throw new AppError(
        StatusCodes.FORBIDDEN,
        "You do not have permission to access this branch",
      );
    }

    return { branch, actor: { staff: req.staff } as TBranchActor };
  }

  throw new AppError(StatusCodes.UNAUTHORIZED, "You are not authorized");
};
