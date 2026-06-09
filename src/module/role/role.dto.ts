import { z } from "zod";

const permissionsSchema = z.object({
  canManageMembers: z.boolean().optional(),
  canManagePackages: z.boolean().optional(),
  canManagePayments: z.boolean().optional(),
  canManageBilling: z.boolean().optional(),
  canManageExpenses: z.boolean().optional(),
  canManageLockers: z.boolean().optional(),
});

const updateRolePermissionsDto = z.object({
  data: permissionsSchema.strict(),
});

const checkCreateBranchRolesDto = z.object({
  // no body required - just checking/creating default roles
});

export const RoleDto = {
  updatePermissions: updateRolePermissionsDto,
  checkCreateBranchRoles: checkCreateBranchRolesDto,
};
