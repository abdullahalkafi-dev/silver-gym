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
const DEFAULT_ROLE_NAMES = ["Admin", "Manager", "Sales"];

type CreateRolePayload = Omit<TRole, "_id" | "createdAt" | "updatedAt">;

/**
 * Initialize default roles for a branch (Admin, Manager, Sales)
 * - Admin: All permissions TRUE
 * - Manager: All permissions FALSE
 * - Sales: All permissions FALSE
 */
const initializeBranchRoles = async (branchId: string) => {
  // Check if roles already exist for this branch
  const existingRolesCount = await RoleRepository.count({
    branchId: new Types.ObjectId(branchId),
  });

  if (existingRolesCount > 0) {
    // Roles already exist, return them
    return await RoleRepository.findMany({
      branchId: new Types.ObjectId(branchId),
    });
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
  // Check if roles already exist
  const existingRoles = await RoleRepository.findMany({
    branchId: new Types.ObjectId(branchId),
  });

  if (existingRoles.length === 3) {
    // All 3 roles already exist
    return {
      created: false,
      roles: existingRoles,
      message: "Roles already exist for this branch",
    };
  } else if (existingRoles.length === 0) {
    // Create roles
    const roles = await initializeBranchRoles(branchId);
    return {
      created: true,
      roles,
      message: "Default roles created successfully",
    };
  } else {
    // Partial roles exist (inconsistent state), recreate them
    // Delete existing incomplete roles
    await Promise.all(
      existingRoles.map((role) => RoleRepository.deleteById(role._id.toString()))
    );

    // Create new roles
    const roles = await initializeBranchRoles(branchId);
    return {
      created: true,
      roles,
      message: "Incomplete roles were recreated",
    };
  }
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
