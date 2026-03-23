import { StatusCodes } from "http-status-codes";
import { Types } from "mongoose";
import AppError from "../../errors/AppError";
import { TBranch } from "./branch.interface";
import { BranchRepository } from "./branch.repository";
import { BusinessProfileRepository } from "../businessProfile/businessProfile.repository";
import unlinkFile from "../../shared/unlinkFile";

/**
 * Extract branch logo filename from file path (relative path)
 */
const getLogoRelativePath = (fullPath: string): string => {
  const relativePath = fullPath.replace(/\\/g, "/").split("uploads/")[1];
  return relativePath || fullPath;
};

type CreateBranchPayload = Omit<TBranch, "_id" | "createdAt" | "updatedAt">;

/**
 * Create a new branch for a business
 */
const createBranch = async (
  businessId: string,
  payload: Omit<CreateBranchPayload, "businessId" | "logo">,
  logoFile?: Express.Multer.File
) => {
  // Verify business exists
  const business = await BusinessProfileRepository.findById(businessId);

  if (!business) {
    // Cleanup uploaded file if business not found
    if (logoFile) {
      unlinkFile(getLogoRelativePath(logoFile.path));
    }
    throw new AppError(
      StatusCodes.NOT_FOUND,
      "Business profile not found"
    );
  }

  // Prepare branch data
  const branchData: CreateBranchPayload = {
    businessId: new Types.ObjectId(businessId),
    ...payload,
    logo: logoFile ? getLogoRelativePath(logoFile.path) : null,
  };

  // Create branch
  const branch = await BranchRepository.create(branchData);

  if (!branch) {
    // Cleanup file if branch creation fails
    if (logoFile) {
      unlinkFile(getLogoRelativePath(logoFile.path));
    }
    throw new AppError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      "Failed to create branch"
    );
  }

  return branch;
};

/**
 * Get all branches for a business
 */
const getBranches = async (businessId: string, options?: any) => {
  const branches = await BranchRepository.findMany(
    { businessId: new Types.ObjectId(businessId) },
    { sort: { isDefault: -1, createdAt: -1 }, ...options }
  );

  return branches;
};

/**
 * Get default branch for a business
 */
const getDefaultBranch = async (businessId: string) => {
  const branch = await BranchRepository.findOne({
    businessId: new Types.ObjectId(businessId),
    isDefault: true,
  });

  if (!branch) {
    throw new AppError(
      StatusCodes.NOT_FOUND,
      "Default branch not found"
    );
  }

  return branch;
};

/**
 * Update branch information
 */
const updateBranch = async (
  branchId: string,
  payload: Partial<Omit<CreateBranchPayload, "businessId">>,
  logoFile?: Express.Multer.File
) => {
  const branch = await BranchRepository.findById(branchId);

  if (!branch) {
    // Cleanup file if branch not found
    if (logoFile) {
      unlinkFile(getLogoRelativePath(logoFile.path));
    }
    throw new AppError(
      StatusCodes.NOT_FOUND,
      "Branch not found"
    );
  }

  // Delete old logo if replacing
  if (logoFile && branch.logo) {
    unlinkFile(branch.logo);
  }

  // Prepare update data
  const updateData: Partial<CreateBranchPayload> = {
    ...payload,
    ...(logoFile && { logo: getLogoRelativePath(logoFile.path) }),
  };

  const updatedBranch = await BranchRepository.updateById(branchId, updateData);

  if (!updatedBranch) {
    // Cleanup new file if update fails
    if (logoFile) {
      unlinkFile(getLogoRelativePath(logoFile.path));
    }
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
