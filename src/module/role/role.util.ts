import { RoleRepository } from "./role.repository";
import { TRole } from "./role.interface";

/**
 * Get all permissions for a specific role by roleId
 * Returns an object with all permission fields and their boolean values
 */
export const getPermissionsByRoleId = async (roleId: string) => {
  const role = await RoleRepository.findById(roleId);

  if (!role) {
    return null;
  }

  return {
    canViewMembers: role.canViewMembers || false,
    canAddMember: role.canAddMember || false,
    canEditMember: role.canEditMember || false,
    canDeleteMember: role.canDeleteMember || false,
    canViewPackages: role.canViewPackages || false,
    canAddPackage: role.canAddPackage || false,
    canEditPackage: role.canEditPackage || false,
    canDeletePackage: role.canDeletePackage || false,
    canViewBilling: role.canViewBilling || false,
    canAddBilling: role.canAddBilling || false,
    canEditBilling: role.canEditBilling || false,
    canDeleteBilling: role.canDeleteBilling || false,
    canViewAnalytics: role.canViewAnalytics || false,
    canExportAnalytics: role.canExportAnalytics || false,
    canViewSMS: role.canViewSMS || false,
    canSendSMS: role.canSendSMS || false,
    canViewEmail: role.canViewEmail || false,
    canSendEmail: role.canSendEmail || false,
  };
};

/**
 * Get all permission fields that can be updated
 * Useful for initialization of roles
 */
export const getAllPermissionFields = (): Record<string, boolean> => {
  return {
    canViewMembers: false,
    canAddMember: false,
    canEditMember: false,
    canDeleteMember: false,
    canViewPackages: false,
    canAddPackage: false,
    canEditPackage: false,
    canDeletePackage: false,
    canViewBilling: false,
    canAddBilling: false,
    canEditBilling: false,
    canDeleteBilling: false,
    canViewAnalytics: false,
    canExportAnalytics: false,
    canViewSMS: false,
    canSendSMS: false,
    canViewEmail: false,
    canSendEmail: false,
  };
};

/**
 * Get all permissions for admin role (all true)
 */
export const getAdminPermissions = (): Record<string, boolean> => {
  const permissions: Record<string, boolean> = {};
  const allFields = getAllPermissionFields();

  for (const field of Object.keys(allFields)) {
    permissions[field] = true;
  }

  return permissions;
};
