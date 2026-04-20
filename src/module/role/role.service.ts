import { StatusCodes } from "http-status-codes";
import { Types } from "mongoose";
import AppError from "../../errors/AppError";
import { TRole } from "./role.interface";
import { RoleRepository } from "./role.repository";
import {
  getAdminPermissions,
  getAllPermissionFields,
  getPermissionsByRoleId,
} from "./role.util";

// Default role names that can be created (system-generated only)
// const DEFAULT_ROLE_NAMES = ["Admin", "Manager", "Sales"];

type CreateRolePayload = Omit<TRole, "_id" | "createdAt" | "updatedAt">;

/**
 * Initialize default roles for a branch (Admin, Manager, Sales)
 * - Admin: All permissions TRUE
 * - Manager: All permissions FALSE
 * - Sales: All permissions FALSE
 * OPTIMIZED: Single query to check + create (avoids N+1)
 */
const initializeBranchRoles = async (branchId: string) => {
  // OPTIMIZED: Fetch existing roles in single query instead of count + findMany
  const existingRoles = await RoleRepository.findMany({
    branchId: new Types.ObjectId(branchId),
  });

  if (existingRoles.length === 3) {
    // All roles already exist - expected state
    return existingRoles;
  }

  if (existingRoles.length > 0 && existingRoles.length < 3) {
    // IMPORTANT ISSUE: Partial roles exist (inconsistent DB state)
    
    // Delete incomplete roles
    await Promise.all(
      existingRoles.map((role) => RoleRepository.deleteById(role._id.toString()))
    );
  }

  // Prepare role data
  const adminPermissions = getAdminPermissions();
  const defaultPermissions = getAllPermissionFields();

  const rolesToCreate: CreateRolePayload[] = [
    {
      branchId: new Types.ObjectId(branchId),
      roleName: "Admin",
      ...adminPermissions,
    },
    {
      branchId: new Types.ObjectId(branchId),
      roleName: "Manager",
      ...defaultPermissions,
    },
    {
      branchId: new Types.ObjectId(branchId),
      roleName: "Sales",
      ...defaultPermissions,
    },
  ];

  // Create all roles
  const createdRoles = await Promise.all(
    rolesToCreate.map((roleData) => RoleRepository.create(roleData))
  );

  return createdRoles;
};

/**
 * Check if roles exist for a branch, if not create them (for branch owners)
 * API endpoint: GET /api/v1/roles/:branchId/initialize

 */
const checkAndCreateBranchRoles = async (branchId: string) => {
  // Single call to initializeBranchRoles (handles all scenarios internally)
  const roles = await initializeBranchRoles(branchId);

  return {
    created: roles.length > 0,
    roles,
    message: roles.length > 0 ? "Roles initialized successfully" : "No roles returned",
  };
};

/**
 * Get all roles for a branch
 */
const getRolesByBranch = async (branchId: string) => {
  const roles = await RoleRepository.findMany({
    branchId: new Types.ObjectId(branchId),
  });

  if (!roles || roles.length === 0) {
    throw new AppError(StatusCodes.NOT_FOUND, "No roles found for this branch");
  }

  return roles;
};

/**
 * Get a single role by ID
 */
const getRoleById = async (roleId: string) => {
  const role = await RoleRepository.findById(roleId);

  if (!role) {
    throw new AppError(StatusCodes.NOT_FOUND, "Role not found");
  }

  return role;
};

/**
 * Update role permissions (only permissions can be updated)
 * Cannot update roleName - roles are system-generated
 */
const updateRolePermissions = async (
  roleId: string,
  branchId: string,
  permissions: Partial<Omit<TRole, "branchId" | "roleName" | "_id" | "createdAt" | "updatedAt">>
) => {
  // Verify role exists and belongs to the specified branch
  const role = await RoleRepository.findOne({
    _id: new Types.ObjectId(roleId),
    branchId: new Types.ObjectId(branchId),
  });

  if (!role) {
    throw new AppError(StatusCodes.NOT_FOUND, "Role not found for this branch");
  }

  // System-generated roles cannot be deleted or have their name changed
  // Only permissions can be updated
  const updatePayload = { ...permissions };

  const updatedRole = await RoleRepository.updateById(roleId, updatePayload);

  if (!updatedRole) {
    throw new AppError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      "Failed to update role permissions"
    );
  }

  return updatedRole;
};

/**
 * Get permissions for a role (fast utility)
 */
const getRolePermissions = async (roleId: string) => {
  const permissions = await getPermissionsByRoleId(roleId);

  if (!permissions) {
    throw new AppError(StatusCodes.NOT_FOUND, "Role not found");
  }

  return permissions;
};

export const RoleService = {
  initializeBranchRoles,
  checkAndCreateBranchRoles,
  getRolesByBranch,
  getRoleById,
  updateRolePermissions,
  getRolePermissions,
};
