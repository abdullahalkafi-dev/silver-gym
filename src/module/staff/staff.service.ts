import { StatusCodes } from "http-status-codes";
import { Types } from "mongoose";
import AppError from "../../errors/AppError";
import { TStaff } from "./staff.interface";
import { StaffRepository } from "./staff.repository";
import { BusinessProfileRepository } from "../businessProfile/businessProfile.repository";
import { BranchRepository } from "../branch/branch.repository";
import { RoleRepository } from "../role/role.repository";
import {
  generateStaffUsernameOptions,
  isValidUsername,
} from "./staff.util";
import generateHashPassword from "@util/generateHashPassword";

type CreateStaffPayload = Omit<
  TStaff,
  "createdAt" | "updatedAt" | "lastLogin" | "assignedAt"
>;

/**
 * Suggest staff usernames based on input string
 * Single bulk query for maximum performance
 */
const suggestUsernames = async (base: string, limit = 6): Promise<string[]> => {
  if (!base || base.length < 2) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Base must be at least 2 characters");
  }

  // Generate username options (Gmail-style)
  let usernameOptions = generateStaffUsernameOptions(base, 60);

  if (usernameOptions.length === 0) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "Could not generate username options"
    );
  }

  // Single bulk query - check which are taken
  const taken = await StaffRepository.findMany(
    { username: { $in: usernameOptions } },
    { select: { username: 1 } }
  );

  const takenSet = new Set(taken.map((u: any) => u.username));
  const available = usernameOptions.filter((c) => !takenSet.has(c));

  // If not enough, generate more padded fallbacks
  // If not enough, generate more padded fallbacks
  if (available.length < limit) {
    const cleaned = base
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 12);
    let i = 1;
    while (available.length < limit && i <= 10000) {
      const fallback = `${cleaned}${String(i).padStart(4, "0")}`;
      if (!takenSet.has(fallback)) {
        available.push(fallback);
      }
      i++;
    }
  }

  return available.slice(0, limit);
};

/**
 * Check if staff username is available globally
 */
const checkUsernameAvailability = async (username: string): Promise<boolean> => {
  if (!isValidUsername(username)) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Invalid username format");
  }

  const exists = await StaffRepository.findOne({
    username: username.toLowerCase(),
  });

  return !exists;
};

/**
 * Create a new staff member
 */
const createStaff = async (
  branchId: string,
  userId: Types.ObjectId,
  payload: Omit<CreateStaffPayload, "branchId" | "assignedBy">
) => {
  // Validate and check username globally early
  if (!isValidUsername(payload.username)) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Invalid username format");
  }

  // Execute non-dependent queries in parallel
  const [branch, role, existingStaff] = await Promise.all([
    BranchRepository.findOne({ _id: new Types.ObjectId(branchId) }),
    RoleRepository.findOne({
      _id: new Types.ObjectId(payload.roleId),
      branchId: new Types.ObjectId(branchId),
    }),
    StaffRepository.findOne({ username: payload.username.toLowerCase() }),
  ]);

  if (!branch) {
    throw new AppError(StatusCodes.NOT_FOUND, "Branch not found");
  }

  // Verify user is the owner of the branch's business
  const businessProfile = await BusinessProfileRepository.findOne({
    _id: branch.businessId,
    userId: userId,
  });

  if (!businessProfile) {
    throw new AppError(
      StatusCodes.FORBIDDEN,
      "You do not have permission to create staff in this branch"
    );
  }

  if (!role) {
    throw new AppError(
      StatusCodes.NOT_FOUND,
      "Role not found or does not belong to this branch"
    );
  }

  if (existingStaff) {
    throw new AppError(StatusCodes.CONFLICT, "Username already exists");
  }

  // Prepare staff data
  const staffData: CreateStaffPayload = {
    branchId: new Types.ObjectId(branchId),
    assignedBy: userId,
    ...payload,
    displayName: payload.displayName || payload.username,
    username: payload.username.toLowerCase(),
    email: payload.email?.toLowerCase(),
    password: payload.password
      ? await generateHashPassword(payload.password)
      : undefined,
    isActive: true,
  };

  // Create staff
  const staff = await StaffRepository.create(staffData);

  if (!staff) {
    throw new AppError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      "Failed to create staff member"
    );
  }

  return staff;
};

/**
 * Get all staff members for a branch with their role permissions
 */
const getStaffListByBranch = async (branchId: string, options?: any) => {
  const branch = await BranchRepository.findOne({
    _id: new Types.ObjectId(branchId),
  });

  if (!branch) {
    throw new AppError(StatusCodes.NOT_FOUND, "Branch not found");
  }

  const staffList = await StaffRepository.findMany(
    { branchId: new Types.ObjectId(branchId) },
    {
      populate: "roleId",
      sort: { isActive: -1, createdAt: -1 },
      ...options,
    }
  );

  const staffWithPermissions = staffList.map((staff: any) => {
    const staffObj = staff.toObject ? staff.toObject() : staff;

    return {
      ...staffObj,
      rolePermissions: staffObj.roleId
        ? {
            roleId: staffObj.roleId._id,
            roleName: staffObj.roleId.roleName,
            permissions: {
              members: {
                canView: staffObj.roleId.canViewMembers,
                canAdd: staffObj.roleId.canAddMember,
                canEdit: staffObj.roleId.canEditMember,
                canDelete: staffObj.roleId.canDeleteMember,
              },
              packages: {
                canView: staffObj.roleId.canViewPackages,
                canAdd: staffObj.roleId.canAddPackage,
                canEdit: staffObj.roleId.canEditPackage,
                canDelete: staffObj.roleId.canDeletePackage,
              },
              billing: {
                canView: staffObj.roleId.canViewBilling,
                canAdd: staffObj.roleId.canAddBilling,
                canEdit: staffObj.roleId.canEditBilling,
                canDelete: staffObj.roleId.canDeleteBilling,
              },
              analytics: {
                canView: staffObj.roleId.canViewAnalytics,
                canExport: staffObj.roleId.canExportAnalytics,
              },
              communications: {
                sms: {
                  canView: staffObj.roleId.canViewSMS,
                  canSend: staffObj.roleId.canSendSMS,
                },
                email: {
                  canView: staffObj.roleId.canViewEmail,
                  canSend: staffObj.roleId.canSendEmail,
                },
              },
            },
          }
        : null,
    };
  });

  return staffWithPermissions;
};

/**
 * Get a single staff member by ID with role permissions
 */
const getStaffById = async (
  staffId: string,
  branchId: string,
  userId: Types.ObjectId,
) => {
  const branch = await BranchRepository.findOne({
    _id: new Types.ObjectId(branchId),
  });

  if (!branch) {
    throw new AppError(StatusCodes.NOT_FOUND, "Branch not found");
  }

  const businessProfile = await BusinessProfileRepository.findOne({
    _id: branch.businessId,
    userId,
  });

  if (!businessProfile) {
    throw new AppError(
      StatusCodes.FORBIDDEN,
      "You do not have permission to access this branch"
    );
  }

  const staffWithRole = await StaffRepository.findOne(
    {
      _id: new Types.ObjectId(staffId),
      branchId: new Types.ObjectId(branchId),
    },
    { populate: "roleId" },
  );

  if (!staffWithRole) {
    throw new AppError(
      StatusCodes.NOT_FOUND,
      "Staff member not found"
    );
  }

  const staffObj = (staffWithRole.toObject ? staffWithRole.toObject() : staffWithRole) as any;

  return {
    ...staffObj,
    rolePermissions: staffObj.roleId
      ? {
          roleId: staffObj.roleId._id,
          roleName: staffObj.roleId.roleName,
          permissions: {
            members: {
              canView: staffObj.roleId.canViewMembers,
              canAdd: staffObj.roleId.canAddMember,
              canEdit: staffObj.roleId.canEditMember,
              canDelete: staffObj.roleId.canDeleteMember,
            },
            packages: {
              canView: staffObj.roleId.canViewPackages,
              canAdd: staffObj.roleId.canAddPackage,
              canEdit: staffObj.roleId.canEditPackage,
              canDelete: staffObj.roleId.canDeletePackage,
            },
            billing: {
              canView: staffObj.roleId.canViewBilling,
              canAdd: staffObj.roleId.canAddBilling,
              canEdit: staffObj.roleId.canEditBilling,
              canDelete: staffObj.roleId.canDeleteBilling,
            },
            analytics: {
              canView: staffObj.roleId.canViewAnalytics,
              canExport: staffObj.roleId.canExportAnalytics,
            },
            communications: {
              sms: {
                canView: staffObj.roleId.canViewSMS,
                canSend: staffObj.roleId.canSendSMS,
              },
              email: {
                canView: staffObj.roleId.canViewEmail,
                canSend: staffObj.roleId.canSendEmail,
              },
            },
          },
        }
      : null,
  };
};

/**
 * Update staff member information
 */
const updateStaff = async (
  staffId: string,
  branchId: string,
  payload: Partial<Omit<CreateStaffPayload, "branchId" | "assignedBy">>
) => {
  // Verify staff exists and belongs to the branch
  const staff = await StaffRepository.findOne({
    _id: new Types.ObjectId(staffId),
    branchId: new Types.ObjectId(branchId),
  });

  if (!staff) {
    throw new AppError(
      StatusCodes.NOT_FOUND,
      "Staff member not found"
    );
  }

  // If roleId is being updated, verify it belongs to the same branch
  if (payload.roleId) {
    const role = await RoleRepository.findOne({
      _id: new Types.ObjectId(payload.roleId),
      branchId: new Types.ObjectId(branchId),
    });

    if (!role) {
      throw new AppError(
        StatusCodes.NOT_FOUND,
        "Role not found or does not belong to this branch"
      );
    }
  }

  // Prepare update data
  const updateData: any = {
    ...payload,
  };

  // Hash password if provided
  if (payload.password) {
    updateData.password = await generateHashPassword(payload.password);
  }

  if (payload.email) {
    updateData.email = payload.email.toLowerCase();
  }

  // Update staff
  const updatedStaff = await StaffRepository.updateById(staffId, updateData);

  if (!updatedStaff) {
    throw new AppError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      "Failed to update staff member"
    );
  }

  return updatedStaff;
};

/**
 * Deactivate a staff member
 */
const deactivateStaff = async (staffId: string, branchId: string) => {
  // Verify staff exists and belongs to the branch
  const staff = await StaffRepository.findOne({
    _id: new Types.ObjectId(staffId),
    branchId: new Types.ObjectId(branchId),
  });

  if (!staff) {
    throw new AppError(
      StatusCodes.NOT_FOUND,
      "Staff member not found"
    );
  }

  // Update staff to deactivate
  const updatedStaff = await StaffRepository.updateById(staffId, {
    isActive: false,
  });

  if (!updatedStaff) {
    throw new AppError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      "Failed to deactivate staff member"
    );
  }

  return updatedStaff;
};

/**
 * Activate a staff member
 */
const activateStaff = async (staffId: string, branchId: string) => {
  // Verify staff exists and belongs to the branch
  const staff = await StaffRepository.findOne({
    _id: new Types.ObjectId(staffId),
    branchId: new Types.ObjectId(branchId),
  });

  if (!staff) {
    throw new AppError(
      StatusCodes.NOT_FOUND,
      "Staff member not found"
    );
  }

  // Update staff to activate
  const updatedStaff = await StaffRepository.updateById(staffId, {
    isActive: true,
  });

  if (!updatedStaff) {
    throw new AppError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      "Failed to activate staff member"
    );
  }

  return updatedStaff;
};

/**
 * Delete a staff member
 */
const deleteStaff = async (staffId: string, branchId: string) => {
  // Verify staff exists and belongs to the branch
  const staff = await StaffRepository.findOne({
    _id: new Types.ObjectId(staffId),
    branchId: new Types.ObjectId(branchId),
  });

  if (!staff) {
    throw new AppError(
      StatusCodes.NOT_FOUND,
      "Staff member not found"
    );
  }

  // Delete staff
  const deletedStaff = await StaffRepository.deleteById(staffId);

  if (!deletedStaff) {
    throw new AppError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      "Failed to delete staff member"
    );
  }

  return deletedStaff;
};

export const StaffService = {
  suggestUsernames,
  checkUsernameAvailability,
  createStaff,
  getStaffListByBranch,
  getStaffById,
  updateStaff,
  deactivateStaff,
  activateStaff,
  deleteStaff,
};
