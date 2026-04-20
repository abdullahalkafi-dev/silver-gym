import { z } from "zod";

const permissionsSchema = z.object({
  canViewMembers: z.boolean().optional(),
  canAddMember: z.boolean().optional(),
  canEditMember: z.boolean().optional(),
  canDeleteMember: z.boolean().optional(),
  canViewPackages: z.boolean().optional(),
  canAddPackage: z.boolean().optional(),
  canEditPackage: z.boolean().optional(),
  canDeletePackage: z.boolean().optional(),
  canViewBilling: z.boolean().optional(),
  canAddBilling: z.boolean().optional(),
  canEditBilling: z.boolean().optional(),
  canDeleteBilling: z.boolean().optional(),
  canAddMonthlyFee: z.boolean().optional(),
  canEditMonthlyFee: z.boolean().optional(),
  canAddAdmissionFee: z.boolean().optional(),
  canEditAdmissionFee: z.boolean().optional(),
  canViewAnalytics: z.boolean().optional(),
  canExportAnalytics: z.boolean().optional(),
  canViewSMS: z.boolean().optional(),
  canSendSMS: z.boolean().optional(),
  canViewEmail: z.boolean().optional(),
  canSendEmail: z.boolean().optional(),
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
