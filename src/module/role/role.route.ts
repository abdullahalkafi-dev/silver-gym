import { Router } from "express";
import { RoleController } from "./role.controller";
import auth from "../../middlewares/auth";
import validateRequest from "../../middlewares/validateRequest";
import { RoleDto } from "./role.dto";

const router = Router({ mergeParams: true });

/**
 * Initialize/Check and Create default roles for a branch
 * Branch owner endpoint to ensure roles exist
 * GET /api/v1/roles/:branchId/initialize
 */
router.get(
  "/:branchId/initialize",
  auth("user"),
  RoleController.checkAndCreateRoles
);

/**
 * Get all roles for a branch
 * GET /api/v1/roles/:branchId
 */
router.get("/:branchId", auth("user"), RoleController.getAllRoles);

/**
 * Get a single role
 * GET /api/v1/roles/:branchId/role/:roleId
 */
router.get(
  "/:branchId/role/:roleId",
  auth("user"),
  RoleController.getRole
);

/**
 * Get permissions for a role
 * GET /api/v1/roles/permissions/:roleId
 */
router.get(
  "/permissions/:roleId",
  auth("user"),
  RoleController.getRolePermissions
);

/**
 * Update role permissions (only permissions, not role name)
 * PATCH /api/v1/roles/:branchId/role/:roleId
 */
router.patch(
  "/:branchId/role/:roleId",
  auth("user"),
  validateRequest(RoleDto.updatePermissions),
  RoleController.updateRolePermissions
);

export const RoleRoute = router;
