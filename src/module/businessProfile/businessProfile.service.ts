import { StatusCodes } from "http-status-codes";
import { Types } from "mongoose";
import AppError from "../../errors/AppError";
import { TBusinessProfile } from "./businessProfile.interface";
import { BusinessProfileRepository } from "./businessProfile.repository";import { BranchRepository } from "../branch/branch.repository";
import unlinkFile from "../../shared/unlinkFile";
import { getLogoRelativePath, validateImageDimensions, validateLogoFile } from "./businessProfile.util";


type CreateBusinessProfilePayload = Omit<TBusinessProfile, "_id" | "createdAt" | "updatedAt">;

/**
 * Create business profile with automatic default branch
 */
const createBusinessProfile = async (
  userId: Types.ObjectId,
  payload: Omit<CreateBusinessProfilePayload, "userId" | "logo">,
  logoFile?: Express.Multer.File
) => {
  // Check if user already has a business profile
  const existingProfile = await BusinessProfileRepository.findOne({
    userId,
  });

  if (existingProfile) {
    // Cleanup uploaded file if profile already exists
    if (logoFile) {
      await unlinkFile(getLogoRelativePath(logoFile.path));
    }
    throw new AppError(
      StatusCodes.CONFLICT,
      "User already has a business profile"
    );
  }

  // Validate logo file if provided
  try {
    validateLogoFile(logoFile);
    if (logoFile) {
      await validateImageDimensions(logoFile.path);
    }
  } catch (error) {
    // Cleanup file on validation failure
    if (logoFile) {
      unlinkFile(getLogoRelativePath(logoFile.path));
    }
    throw error;
  }

  // Prepare business profile data
  const profileData: CreateBusinessProfilePayload = {
    userId,
    ...payload,
    logo: logoFile ? getLogoRelativePath(logoFile.path) : null,
  };

  // Create business profile
  const businessProfile = await BusinessProfileRepository.create(profileData);

  if (!businessProfile) {
    // Cleanup file if profile creation fails
    if (logoFile) {
      await unlinkFile(getLogoRelativePath(logoFile.path));
    }
    throw new AppError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      "Failed to create business profile"
    );
  }

  // Create default branch automatically
  try {
    await BranchRepository.create({
      businessId: businessProfile._id as Types.ObjectId,
      branchName: businessProfile.businessName,
      logo: profileData.logo,
      isDefault: true,
      isActive: true,
    });
  } catch (error) {
    // If branch creation fails, it's not critical but log it
    console.error("Failed to create default branch:", error);
  }

  return businessProfile;
};

/**
 * Get business profile by user ID
 */
const getBusinessProfile = async (userId: Types.ObjectId) => {
  const profile = await BusinessProfileRepository.findOne({ userId });

  if (!profile) {
    throw new AppError(
      StatusCodes.NOT_FOUND,
      "Business profile not found"
    );
  }

  return profile;
};

/**
 * Update business profile
 */
const updateBusinessProfile = async (
  userId: Types.ObjectId,
  payload: Partial<Omit<CreateBusinessProfilePayload, "userId">>,
  logoFile?: Express.Multer.File
) => {
  const profile = await BusinessProfileRepository.findOne({ userId });

  if (!profile) {
    // Cleanup file if profile not found
    if (logoFile) {
      await unlinkFile(getLogoRelativePath(logoFile.path));
    }
    throw new AppError(
      StatusCodes.NOT_FOUND,
      "Business profile not found"
    );
  }

  // Validate new logo file if provided
  try {
    validateLogoFile(logoFile);
    if (logoFile) {
      await validateImageDimensions(logoFile.path);
    }
  } catch (error) {
    // Cleanup file on validation failure
    if (logoFile) {
      await unlinkFile(getLogoRelativePath(logoFile.path));
    }
    throw error;
  }

  // Delete old logo if replacing
  if (logoFile && profile.logo) {
    await unlinkFile(profile.logo);
  }

  // Prepare update data
  const updateData: Partial<CreateBusinessProfilePayload> = {
    ...payload,
    ...(logoFile && { logo: getLogoRelativePath(logoFile.path) }),
  };

  const updatedProfile = await BusinessProfileRepository.updateById(
    String(profile._id),
    updateData
  );

  if (!updatedProfile) {
    // Cleanup new file if update fails
    if (logoFile) {
      unlinkFile(getLogoRelativePath(logoFile.path));
    }
    throw new AppError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      "Failed to update business profile"
    );
  }

  return updatedProfile;
};

export const BusinessProfileService = {
  createBusinessProfile,
  getBusinessProfile,
  updateBusinessProfile,
};
