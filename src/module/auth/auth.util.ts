import { OTPProvider } from "module/otp/otp.interface";
import { LoginProvider } from "module/user/user.interface";
import { TRole } from "module/role/role.interface";
import { TStaff } from "module/staff/staff.interface";
import { Types } from "mongoose";

export type TStaffPermissionSnapshot = {
  canViewMembers: boolean;
  canAddMember: boolean;
  canEditMember: boolean;
  canDeleteMember: boolean;
  canViewPackages: boolean;
  canAddPackage: boolean;
  canEditPackage: boolean;
  canDeletePackage: boolean;
  canViewPayments: boolean;
  canAddPayment: boolean;
  canEditPayment: boolean;
  canDeletePayment: boolean;
  canRefundPayment: boolean;
  canViewBilling: boolean;
  canAddBilling: boolean;
  canEditBilling: boolean;
  canDeleteBilling: boolean;
  canViewAnalytics: boolean;
  canExportAnalytics: boolean;
  canViewSMS: boolean;
  canSendSMS: boolean;
  canViewEmail: boolean;
  canSendEmail: boolean;
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
  canViewMembers: role.canViewMembers ?? false,
  canAddMember: role.canAddMember ?? false,
  canEditMember: role.canEditMember ?? false,
  canDeleteMember: role.canDeleteMember ?? false,
  canViewPackages: role.canViewPackages ?? false,
  canAddPackage: role.canAddPackage ?? false,
  canEditPackage: role.canEditPackage ?? false,
  canDeletePackage: role.canDeletePackage ?? false,
  canViewPayments: role.canViewPayments ?? false,
  canAddPayment: role.canAddPayment ?? false,
  canEditPayment: role.canEditPayment ?? false,
  canDeletePayment: role.canDeletePayment ?? false,
  canRefundPayment: role.canRefundPayment ?? false,
  canViewBilling: role.canViewBilling ?? false,
  canAddBilling: role.canAddBilling ?? false,
  canEditBilling: role.canEditBilling ?? false,
  canDeleteBilling: role.canDeleteBilling ?? false,
  canViewAnalytics: role.canViewAnalytics ?? false,
  canExportAnalytics: role.canExportAnalytics ?? false,
  canViewSMS: role.canViewSMS ?? false,
  canSendSMS: role.canSendSMS ?? false,
  canViewEmail: role.canViewEmail ?? false,
  canSendEmail: role.canSendEmail ?? false,
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
