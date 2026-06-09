import { RoleRepository } from "./role.repository";

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
    canManageMembers: role.canManageMembers || false,
    canManagePackages: role.canManagePackages || false,
    canManagePayments: role.canManagePayments || false,
    canManageBilling: role.canManageBilling || false,
    canManageExpenses: role.canManageExpenses || false,
    canManageLockers: role.canManageLockers || false,
  };
};




/**
 * Get all permission fields that can be updated
 * Useful for initialization of roles
 */
export const getAllPermissionFields = (): Record<string, boolean> => {
  return {
    canManageMembers: false,
    canManagePackages: false,
    canManagePayments: false,
    canManageBilling: false,
    canManageExpenses: false,
    canManageLockers: false,
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
