import { NextFunction, Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { JwtPayload, Secret } from "jsonwebtoken";

import config from "../config";
import AppError from "../errors/AppError";
import { verifyJwtToken } from "jwt";
import {
  getStaffPermissionSnapshot,
  TStaffPermissionSnapshot,
  TStaffTokenPayload,
} from "module/auth/auth.util";
import { RoleRepository } from "module/role/role.repository";
import { StaffRepository } from "module/staff/staff.repository";
import { UserRepository } from "module/user/user.repository";

type AuthStaffOptions = {
  allowOwner?: boolean;
};

const normalizePermissions = (
  input?: Partial<TStaffPermissionSnapshot>,
): TStaffPermissionSnapshot => ({
  canViewMembers: Boolean(input?.canViewMembers),
  canAddMember: Boolean(input?.canAddMember),
  canEditMember: Boolean(input?.canEditMember),
  canDeleteMember: Boolean(input?.canDeleteMember),
  canViewPackages: Boolean(input?.canViewPackages),
  canAddPackage: Boolean(input?.canAddPackage),
  canEditPackage: Boolean(input?.canEditPackage),
  canDeletePackage: Boolean(input?.canDeletePackage),
  canViewPayments: Boolean(input?.canViewPayments),
  canAddPayment: Boolean(input?.canAddPayment),
  canEditPayment: Boolean(input?.canEditPayment),
  canDeletePayment: Boolean(input?.canDeletePayment),
  canRefundPayment: Boolean(input?.canRefundPayment),
  canViewBilling: Boolean(input?.canViewBilling),
  canAddBilling: Boolean(input?.canAddBilling),
  canEditBilling: Boolean(input?.canEditBilling),
  canDeleteBilling: Boolean(input?.canDeleteBilling),
  canAddMonthlyFee: Boolean(input?.canAddMonthlyFee),
  canEditMonthlyFee: Boolean(input?.canEditMonthlyFee),
  canAddAdmissionFee: Boolean(input?.canAddAdmissionFee),
  canEditAdmissionFee: Boolean(input?.canEditAdmissionFee),
  canViewAnalytics: Boolean(input?.canViewAnalytics),
  canExportAnalytics: Boolean(input?.canExportAnalytics),
  canViewSMS: Boolean(input?.canViewSMS),
  canSendSMS: Boolean(input?.canSendSMS),
  canViewEmail: Boolean(input?.canViewEmail),
  canSendEmail: Boolean(input?.canSendEmail),
});

const authStaff =
  (options: AuthStaffOptions = {}) =>
  async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const tokenWithBearer = req.headers.authorization;

      if (!tokenWithBearer || !tokenWithBearer.startsWith("Bearer ")) {
        throw new AppError(StatusCodes.UNAUTHORIZED, "You are not authorized");
      }

      const token = tokenWithBearer.split(" ")[1];

      if (!token) {
        throw new AppError(StatusCodes.UNAUTHORIZED, "You are not authorized");
      }

      const decoded = verifyJwtToken(
        token,
        config.jwt.jwt_secret as Secret,
      ) as JwtPayload & Partial<TStaffTokenPayload>;

      if (decoded.tokenType === "staff") {
        if (!decoded.staffId) {
          throw new AppError(StatusCodes.UNAUTHORIZED, "You are not authorized");
        }

        const staff = await StaffRepository.findById(decoded.staffId);

        if (!staff || !staff.isActive) {
          throw new AppError(StatusCodes.UNAUTHORIZED, "You are not authorized");
        }

        if (decoded.branchId && String(staff.branchId) !== decoded.branchId) {
          throw new AppError(StatusCodes.UNAUTHORIZED, "You are not authorized");
        }

        const role = await RoleRepository.findById(String(staff.roleId));

        if (!role) {
          throw new AppError(StatusCodes.UNAUTHORIZED, "You are not authorized");
        }

        const roleUpdatedAt = role.updatedAt
          ? new Date(role.updatedAt).toISOString()
          : undefined;

        const syncSeconds = Number(config.jwt.staff_permission_sync_seconds || "300");
        const issuedAt = typeof decoded.iat === "number" ? decoded.iat : undefined;
        const tokenAgeSeconds = issuedAt
          ? Math.max(0, Math.floor(Date.now() / 1000) - issuedAt)
          : Number.POSITIVE_INFINITY;
        const shouldRefreshByAge =
          !Number.isFinite(syncSeconds) || syncSeconds <= 0
            ? true
            : tokenAgeSeconds >= syncSeconds;
        const roleChanged = roleUpdatedAt !== decoded.roleUpdatedAt;
        const shouldRefreshPermissions = shouldRefreshByAge || roleChanged;

        let effectivePermissions = normalizePermissions(decoded.permissions);
        let effectiveRoleUpdatedAt = roleUpdatedAt;

        if (shouldRefreshPermissions) {
          effectivePermissions = getStaffPermissionSnapshot(role);
        }

        req.staff = staff;
        req.staffAuth = {
          ...(decoded as TStaffTokenPayload),
          roleUpdatedAt: effectiveRoleUpdatedAt,
          permissions: effectivePermissions,
        };
        req.staffPermissions = effectivePermissions;

        return next();
      }

      if (!options.allowOwner) {
        throw new AppError(StatusCodes.UNAUTHORIZED, "You are not authorized");
      }

      if (!decoded._id) {
        throw new AppError(StatusCodes.UNAUTHORIZED, "You are not authorized");
      }

      const user = await UserRepository.findById(String(decoded._id));

      if (!user || user.status !== "active") {
        throw new AppError(StatusCodes.UNAUTHORIZED, "You are not authorized");
      }

      req.user = user;
      next();
    } catch (error) {
      next(error);
    }
  };

export default authStaff;
