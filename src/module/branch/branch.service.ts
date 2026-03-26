import { StatusCodes } from "http-status-codes";
import { Types } from "mongoose";
import AppError from "../../errors/AppError";
import { errorLogger } from "../../logger/logger";
import { TBranch } from "./branch.interface";
import { BranchRepository } from "./branch.repository";
import { BusinessProfileRepository } from "../businessProfile/businessProfile.repository";
import unlinkFile from "../../shared/unlinkFile";
import { RoleService } from "../role/role.service";

const SERVICE_NAME = "BranchService";

/**
 * Extract branch logo filename from file path (relative path)
 */
const getLogoRelativePath = (fullPath: string): string => {
  const relativePath = fullPath.replace(/\\/g, "/").split("uploads/")[1];
  return relativePath || fullPath;
};

type CreateBranchPayload = Omit<TBranch, "_id" | "createdAt" | "updatedAt">;

/**
 * Create a new branch for a business with ownership verification
 */
const createBranch = async (
  businessId: string,
  userId: Types.ObjectId,
  payload: Omit<CreateBranchPayload, "businessId" | "logo">,
  logoFile?: Express.Multer.File
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
    
    errorLogger.warn(
      `${SERVICE_NAME}.createBranch: UNAUTHORIZED - User ${userId} attempted to create branch for business ${businessId} without ownership`
    );
    
    throw new AppError(
      StatusCodes.FORBIDDEN,
      "You do not have permission to create branches for this business"
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
    
    errorLogger.error(
      `${SERVICE_NAME}.createBranch: CREATE FAILED - Failed to create branch for business ${businessId} after successful verification - POTENTIAL DB ISSUE`
    );
    
    throw new AppError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      "Failed to create branch"
    );
  }

  // Async role initialization (don't wait, but log any critical issues)
  RoleService.initializeBranchRoles(branch._id.toString())
    .catch((error) => {
      errorLogger.error(
        `${SERVICE_NAME}.createBranch: CRITICAL - Role initialization FAILED for branch ${branch._id}. Branch created but roles missing. Error: ${error instanceof Error ? error.message : String(error)}`
      );
    });

  return branch;
};

/**
 * Get all branches for a business with ownership verification
 * Performance: 2 DB queries
 */
const getBranches = async (businessId: string, userId: Types.ObjectId, options?: any) => {
  // Verify user owns the business
  const business = await BusinessProfileRepository.findOne({
    _id: new Types.ObjectId(businessId),
    userId,
  });

  if (!business) {
    errorLogger.warn(
      `${SERVICE_NAME}.getBranches: UNAUTHORIZED - User ${userId} attempted to view branches for business ${businessId} without ownership`
    );
    
    throw new AppError(
      StatusCodes.FORBIDDEN,
      "You do not have permission to view branches for this business"
    );
  }

  const branches = await BranchRepository.findMany(
    { businessId: new Types.ObjectId(businessId) },
    { sort: { isDefault: -1, createdAt: -1 }, ...options }
  );

  return branches;
};

/**
 * Get default branch for a business with ownership verification
 * Performance: 2 DB queries
 */
const getDefaultBranch = async (businessId: string, userId: Types.ObjectId) => {
  // Verify user owns the business
  const business = await BusinessProfileRepository.findOne({
    _id: new Types.ObjectId(businessId),
    userId,
  });

  if (!business) {
    errorLogger.warn(
      `${SERVICE_NAME}.getDefaultBranch: UNAUTHORIZED - User ${userId} attempted to view default branch for business ${businessId} without ownership`
    );
    
    throw new AppError(
      StatusCodes.FORBIDDEN,
      "You do not have permission to view branches for this business"
    );
  }

  const branch = await BranchRepository.findOne({
    businessId: new Types.ObjectId(businessId),
    isDefault: true,
  });

  if (!branch) {
    errorLogger.warn(
      `${SERVICE_NAME}.getDefaultBranch: NOT FOUND - No default branch found for business ${businessId}`
    );
    
    throw new AppError(
      StatusCodes.NOT_FOUND,
      "Default branch not found"
    );
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
  logoFile?: Express.Multer.File
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
    
    errorLogger.warn(
      `${SERVICE_NAME}.updateBranch: BRANCH NOT FOUND - Branch ${branchId} not found for business ${businessId}`
    );
    
    throw new AppError(
      StatusCodes.NOT_FOUND,
      "Branch not found or does not belong to this business"
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
    
    errorLogger.warn(
      `${SERVICE_NAME}.updateBranch: UNAUTHORIZED - User ${userId} attempted to update branch ${branchId} for business ${businessId} without ownership`
    );
    
    throw new AppError(
      StatusCodes.FORBIDDEN,
      "You do not have permission to update this branch"
    );
  }

  // Delete old logo if replacing
  if (logoFile && branch.logo) {
    try {
      await unlinkFile(branch.logo);
    } catch (error) {
      errorLogger.warn(
        `${SERVICE_NAME}.updateBranch: Failed to delete old logo for branch ${branchId}. Error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
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
    
    errorLogger.error(
      `${SERVICE_NAME}.updateBranch: UPDATE FAILED - Failed to update branch ${branchId} after successful verification - POTENTIAL DB ISSUE`
    );
    
    throw new AppError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      "Failed to update branch"
    );
  }

  return updatedBranch;
};

export const BranchService = {
  createBranch,
  getBranches,
  getDefaultBranch,
  updateBranch,
};
