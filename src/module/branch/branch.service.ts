import { StatusCodes } from "http-status-codes";
import { Types } from "mongoose";
import AppError from "../../errors/AppError";
import { TStaffPermissionSnapshot } from "../auth/auth.util";
import { TBranch } from "./branch.interface";
import { BranchRepository } from "./branch.repository";
import { BusinessProfileRepository } from "../businessProfile/businessProfile.repository";
import unlinkFile from "../../shared/unlinkFile";
import { RoleService } from "../role/role.service";
import { TStaff } from "../staff/staff.interface";
import { logger } from "logger/logger";

/**
 * Extract branch logo filename from file path (relative path)
 */
const getLogoRelativePath = (fullPath: string): string => {
  const relativePath = fullPath.replace(/\\/g, "/").split("uploads/")[1];
  return relativePath || fullPath;
};

type CreateBranchPayload = Omit<TBranch, "_id" | "createdAt" | "updatedAt">;

type TBranchAccessActor = {
  userId?: Types.ObjectId;
  staff?: TStaff;
  staffPermissions?: Partial<TStaffPermissionSnapshot>;
};

type TBranchFeeSnapshot = Pick<TBranch, "monthlyFeeAmount" | "admissionFeeAmount">;

type TBranchFeeType = "monthly" | "admission";

/**
 * Create a new branch for a business with ownership verification
 */
const createBranch = async (
  businessId: string,
  userId: Types.ObjectId,
  payload: Omit<CreateBranchPayload, "businessId" | "logo">,
  logoFile?: Express.Multer.File,
) => {
  // Query 1: Verify business exists AND user owns it (combined for efficiency)
  const business = await BusinessProfileRepository.findOne({
    _id: new Types.ObjectId(businessId),
    userId,
  });

  if (!business) {
    // Cleanup uploaded file if not authorized
    if (logoFile) {
      await unlinkFile(getLogoRelativePath(logoFile.path));
    }

    throw new AppError(
      StatusCodes.FORBIDDEN,
      "You do not have permission to create branches for this business",
    );
  }

  // Prepare branch data
  const branchData: CreateBranchPayload = {
    businessId: new Types.ObjectId(businessId),
    ...payload,
    logo: logoFile ? getLogoRelativePath(logoFile.path) : null,
  };

  // Query 2: Create branch
  const branch = await BranchRepository.create(branchData);

  if (!branch) {
    // Cleanup file if branch creation fails
    if (logoFile) {
      await unlinkFile(getLogoRelativePath(logoFile.path));
    }

    throw new AppError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      "Failed to create branch",
    );
  }

  // Async role initialization
  RoleService.initializeBranchRoles(branch._id.toString());

  return branch;
};

const resolveBranchFeeAccess = async (
  businessId: string,
  branchId: string,
  actor: TBranchAccessActor,
) => {
  const branch = await BranchRepository.findOne({
    _id: branchId,
    businessId: new Types.ObjectId(businessId),
  });

  if (!branch) {
    throw new AppError(
      StatusCodes.NOT_FOUND,
      "Branch not found or does not belong to this business",
    );
  }

  if (actor.userId) {
    const business = await BusinessProfileRepository.findOne({
      _id: new Types.ObjectId(businessId),
      userId: actor.userId,
    });

    if (!business) {
      throw new AppError(
        StatusCodes.FORBIDDEN,
        "You do not have permission to access this branch",
      );
    }

    return branch;
  }

  if (actor.staff) {
    if (!actor.staff.isActive) {
      throw new AppError(StatusCodes.FORBIDDEN, "Staff account is inactive");
    }

    if (String(actor.staff.branchId) !== String(branch._id)) {
      throw new AppError(
        StatusCodes.FORBIDDEN,
        "You do not have permission to access this branch",
      );
    }

    return branch;
  }

  throw new AppError(StatusCodes.UNAUTHORIZED, "You are not authorized");
};

const ensureBranchFeesConfigured = (
  branch: TBranchFeeSnapshot,
  entityLabel: "package" | "member",
) => {
  const hasMonthlyFee = typeof branch.monthlyFeeAmount === "number";
  const hasAdmissionFee = typeof branch.admissionFeeAmount === "number";

  if (hasMonthlyFee && hasAdmissionFee) {
    return;
  }

  throw new AppError(
    StatusCodes.BAD_REQUEST,
    `Configure branch monthly fee and admission fee before creating a ${entityLabel}`,
  );
};

const ensureBranchFeePermission = (
  branch: TBranchFeeSnapshot,
  actor: TBranchAccessActor,
  feeType: TBranchFeeType,
) => {
  if (actor.userId) {
    return;
  }

  const permissionMap = {
    monthly: {
      currentValue: branch.monthlyFeeAmount,
      add: "canAddMonthlyFee" as const,
      edit: "canEditMonthlyFee" as const,
      label: "monthly fee",
    },
    admission: {
      currentValue: branch.admissionFeeAmount,
      add: "canAddAdmissionFee" as const,
      edit: "canEditAdmissionFee" as const,
      label: "admission fee",
    },
  };

  const targetFee = permissionMap[feeType];
  const isConfigured = typeof targetFee.currentValue === "number";
  const requiredPermission = isConfigured ? targetFee.edit : targetFee.add;
  const actionLabel = isConfigured ? "edit" : "add";

  if (actor.staffPermissions?.[requiredPermission]) {
    return;
  }

  throw new AppError(
    StatusCodes.FORBIDDEN,
    `You do not have permission to ${actionLabel} the branch ${targetFee.label}`,
  );
};

/**
 * Get all branches for a business with ownership verification
 * Performance: 2 DB queries
 */
const getBranches = async (
  businessId: string,
  userId: Types.ObjectId,
  options?: any,
) => {
  // Verify user owns the business
  const business = await BusinessProfileRepository.findOne({
    _id: new Types.ObjectId(businessId),
    userId,
  });

  if (!business) {
    throw new AppError(
      StatusCodes.FORBIDDEN,
      "You do not have permission to view branches for this business",
    );
  }

  const branches = await BranchRepository.findMany(
    { businessId: new Types.ObjectId(businessId) },
    { sort: { isDefault: -1, createdAt: -1 }, ...options },
  );

  return branches;
};

/**
 * Get default branch for a business with ownership verification
 * If no default branch exists, create one automatically
 * Performance: 2-3 DB queries (3 if creating new default branch)
 */
const getDefaultBranch = async (businessId: string, userId: Types.ObjectId) => {
  // Verify user owns the business
  const business = await BusinessProfileRepository.findOne({
    _id: new Types.ObjectId(businessId),
    userId,
  });

  if (!business) {
    throw new AppError(
      StatusCodes.FORBIDDEN,
      "You do not have permission to view branches for this business",
    );
  }

  const branch = await BranchRepository.findOne({
    businessId: new Types.ObjectId(businessId),
    isDefault: true,
  });

  logger.info(business);
  if (!branch) {
    // Auto-create default branch if it doesn't exist
    const defaultBranchData: CreateBranchPayload = {
      businessId: new Types.ObjectId(businessId),
      branchName: `${business.businessName}`,
      branchAddress: business.businessAddress || undefined,
      isDefault: true,
      isActive: true,
      logo: business.logo || null,
      favicon: business.logo || null,
    };

    const newDefaultBranch = await BranchRepository.create(defaultBranchData);

    if (!newDefaultBranch) {
      throw new AppError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        "Failed to create default branch",
      );
    }

    // Async role initialization for the new branch
    RoleService.initializeBranchRoles(newDefaultBranch._id.toString());

    return newDefaultBranch;
  }

  return branch;
};

/**
 * Update branch information with ownership verification

 */
const updateBranch = async (
  branchId: string,
  businessId: string,
  userId: Types.ObjectId,
  payload: Partial<Omit<CreateBranchPayload, "businessId">>,
  logoFile?: Express.Multer.File,
) => {
  // Query 1: Verify branch exists AND belongs to the specified business (combined for efficiency)
  const branch = await BranchRepository.findOne({
    _id: branchId,
    businessId: new Types.ObjectId(businessId),
  });

  if (!branch) {
    // Cleanup file if branch not found or doesn't belong to business
    if (logoFile) {
      await unlinkFile(getLogoRelativePath(logoFile.path));
    }

    throw new AppError(
      StatusCodes.NOT_FOUND,
      "Branch not found or does not belong to this business",
    );
  }

  // Query 2: Verify user owns the business (combined condition for efficiency)
  const business = await BusinessProfileRepository.findOne({
    _id: new Types.ObjectId(businessId),
    userId,
  });

  if (!business) {
    // Cleanup file if user is not the owner
    if (logoFile) {
      await unlinkFile(getLogoRelativePath(logoFile.path));
    }

    throw new AppError(
      StatusCodes.FORBIDDEN,
      "You do not have permission to update this branch",
    );
  }

  // Delete old logo if replacing
  if (logoFile && branch.logo) {
    try {
      await unlinkFile(branch.logo);
    } catch (error) {}
  }

  // Prepare update data
  const updateData: Partial<CreateBranchPayload> = {
    ...payload,
    ...(logoFile && { logo: getLogoRelativePath(logoFile.path) }),
  };

  // Query 3: Update branch
  const updatedBranch = await BranchRepository.updateById(branchId, updateData);

  if (!updatedBranch) {
    // Cleanup new file if update fails
    if (logoFile) {
      await unlinkFile(getLogoRelativePath(logoFile.path));
    }

    throw new AppError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      "Failed to update branch",
    );
  }

  return updatedBranch;
};

const getBranchMonthlyFee = async (
  businessId: string,
  branchId: string,
  actor: TBranchAccessActor,
) => {
  const branch = await resolveBranchFeeAccess(
    businessId,
    branchId,
    actor,
  );

  return {
    branchId: branch._id,
    branchName: branch.branchName,
    monthlyFeeAmount:
      typeof branch.monthlyFeeAmount === "number"
        ? branch.monthlyFeeAmount
        : null,
  };
};

const updateBranchMonthlyFee = async (
  businessId: string,
  branchId: string,
  actor: TBranchAccessActor,
  monthlyFeeAmount: number,
) => {
  const branch = await resolveBranchFeeAccess(businessId, branchId, actor);
  ensureBranchFeePermission(branch, actor, "monthly");

  const updatedBranch = await BranchRepository.updateById(branchId, {
    monthlyFeeAmount,
  });

  if (!updatedBranch) {
    throw new AppError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      "Failed to update branch monthly fee",
    );
  }

  return updatedBranch;
};

const getBranchAdmissionFee = async (
  businessId: string,
  branchId: string,
  actor: TBranchAccessActor,
) => {
  const branch = await resolveBranchFeeAccess(
    businessId,
    branchId,
    actor,
  );

  return {
    branchId: branch._id,
    branchName: branch.branchName,
    admissionFeeAmount:
      typeof branch.admissionFeeAmount === "number"
        ? branch.admissionFeeAmount
        : null,
  };
};

const updateBranchAdmissionFee = async (
  businessId: string,
  branchId: string,
  actor: TBranchAccessActor,
  admissionFeeAmount: number,
) => {
  const branch = await resolveBranchFeeAccess(businessId, branchId, actor);
  ensureBranchFeePermission(branch, actor, "admission");

  const updatedBranch = await BranchRepository.updateById(branchId, {
    admissionFeeAmount,
  });

  if (!updatedBranch) {
    throw new AppError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      "Failed to update branch admission fee",
    );
  }

  return updatedBranch;
};

export const BranchService = {
  createBranch,
  getBranches,
  getDefaultBranch,
  updateBranch,
  ensureBranchFeesConfigured,
  getBranchMonthlyFee,
  updateBranchMonthlyFee,
  getBranchAdmissionFee,
  updateBranchAdmissionFee,
};
