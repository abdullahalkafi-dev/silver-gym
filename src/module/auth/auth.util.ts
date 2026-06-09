import { OTPProvider } from "module/otp/otp.interface";
import { LoginProvider } from "module/user/user.interface";
import { TRole } from "module/role/role.interface";
import { TStaff } from "module/staff/staff.interface";
import { Types } from "mongoose";

export type TStaffPermissionSnapshot = {
  canManageMembers: boolean;
  canManagePackages: boolean;
  canManagePayments: boolean;
  canManageBilling: boolean;
  canManageExpenses: boolean;
  canManageLockers: boolean;
};

export type TStaffPermissionKey = keyof TStaffPermissionSnapshot;

export type TStaffTokenPayload = {
  tokenType: "staff";
  staffId: string;
  branchId: string;
  roleId: string;
  roleName: string;
  roleUpdatedAt?: string;
  permissions: TStaffPermissionSnapshot;
};

export const getNormalizedIdentity = (payload: { email?: string; phone?: string }) => {
  return {
    email: payload.email?.trim().toLowerCase(),
    phone: payload.phone?.trim(),
  };
};

export const getOtpChannel = (user: {
  email?: string;
  phone?: string;
  isEmailVerified?: boolean;
  isPhoneVerified?: boolean;
}) => {
  if (user.email && !user.isEmailVerified) {
    return { provider: "email" as OTPProvider, target: user.email };
  }

  if (user.phone && !user.isPhoneVerified) {
    return { provider: "phone" as OTPProvider, target: user.phone };
  }

  if (user.email) {
    return { provider: "email" as OTPProvider, target: user.email };
  }

  if (user.phone) {
    return { provider: "phone" as OTPProvider, target: user.phone };
  }

  return null;
};

export const buildTokenPayload = (user: {
  _id: string | Types.ObjectId;
  email?: string;
  phone?: string;
  isSuperAdmin?: boolean;
  loginProvider?: LoginProvider;
}) => ({
  _id: String(user._id),
  email: user.email,
  phone: user.phone,
  isSuperAdmin: Boolean(user.isSuperAdmin),
  loginProvider: user.loginProvider,
});

export const getStaffPermissionSnapshot = (role: TRole): TStaffPermissionSnapshot => ({
  canManageMembers: role.canManageMembers ?? false,
  canManagePackages: role.canManagePackages ?? false,
  canManagePayments: role.canManagePayments ?? false,
  canManageBilling: role.canManageBilling ?? false,
  canManageExpenses: role.canManageExpenses ?? false,
  canManageLockers: role.canManageLockers ?? false,
});

export const buildStaffTokenPayload = (
  staff: TStaff & { _id: string | Types.ObjectId },
  role: TRole & { _id: string | Types.ObjectId }
): TStaffTokenPayload => ({
  tokenType: "staff",
  staffId: String(staff._id),
  branchId: String(staff.branchId),
  roleId: String(role._id),
  roleName: role.roleName,
  roleUpdatedAt: role.updatedAt ? new Date(role.updatedAt).toISOString() : undefined,
  permissions: getStaffPermissionSnapshot(role),
});
