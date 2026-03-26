import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import catchAsync from "../../shared/catchAsync";
import sendResponse from "../../shared/sendResponse";
import { RoleService } from "./role.service";

/**
 * Initialize/Check and Create roles for a branch
 * Branch owner can hit this endpoint to ensure roles are created
 * GET /api/v1/roles/:branchId/initialize
 */
const checkAndCreateRoles = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;

  const result = await RoleService.checkAndCreateBranchRoles(branchId);

  sendResponse(res, {
    statusCode: result.created ? StatusCodes.CREATED : StatusCodes.OK,
    success: true,
    message: result.message,
    data: result.roles,
  });
});

/**
 * Get all roles for a branch
 * GET /api/v1/roles/:branchId
 */
const getAllRoles = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;

  const roles = await RoleService.getRolesByBranch(branchId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Roles retrieved successfully",
    data: roles,
  });
});

/**
 * Get a single role by ID
 * GET /api/v1/roles/:branchId/role/:roleId
 */
const getRole = catchAsync(async (req: Request, res: Response) => {
  const roleId = req.params.roleId as string;
  const branchId = req.params.branchId as string;

  const role = await RoleService.getRoleById(roleId);

  // Verify role belongs to the branch
  if (role.branchId.toString() !== branchId) {
    return sendResponse(res, {
      statusCode: StatusCodes.NOT_FOUND,
      success: false,
      message: "Role not found for this branch",
    });
  }

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Role retrieved successfully",
    data: role,
  });
});

/**
 * Update role permissions
 * PATCH /api/v1/roles/:branchId/role/:roleId
 * Only permissions can be updated, not the role name (system-generated)
 */
const updateRolePermissions = catchAsync(
  async (req: Request, res: Response) => {
    const roleId = req.params.roleId as string;
    const branchId = req.params.branchId as string;

    // Use parsed data if available, otherwise use body
    const permissions = req.body.data || req.body;

    const updatedRole = await RoleService.updateRolePermissions(
      roleId,
      branchId,
      permissions
    );

    sendResponse(res, {
      statusCode: StatusCodes.OK,
      success: true,
      message: "Role permissions updated successfully",
      data: updatedRole,
    });
  }
);

/**
 * Get permissions for a role
 * GET /api/v1/roles/permissions/:roleId
 */
const getRolePermissions = catchAsync(async (req: Request, res: Response) => {
  const roleId = req.params.roleId as string;

  const permissions = await RoleService.getRolePermissions(roleId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Role permissions retrieved successfully",
    data: permissions,
  });
});

export const RoleController = {
  checkAndCreateRoles,
  getAllRoles,
  getRole,
  updateRolePermissions,
  getRolePermissions,
};
