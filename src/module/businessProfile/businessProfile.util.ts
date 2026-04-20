import AppError from "errors/AppError";
import { StatusCodes } from "http-status-codes";
import sharp from "sharp";

/**
 * File upload validation rules for logo
 */
const LOGO_VALIDATION = {
  maxSizeBytes: 5 * 1024 * 1024, // 5MB
  allowedMimeTypes: new Set([
    "image/jpeg",
    "image/png",
    "image/jpg",
    "image/webp",
  ]),
  minWidth: 200,
  minHeight: 200,
};

/**
 * Validate logo file before processing
 * @param file - Express Multer file object
 * @throws AppError if file is invalid
 */
const validateLogoFile = (file: Express.Multer.File | undefined) => {
  if (!file) return;

  // Check file size
  if (file.size > LOGO_VALIDATION.maxSizeBytes) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      `Logo file size must not exceed ${LOGO_VALIDATION.maxSizeBytes / 1024 / 1024}MB`,
    );
  }

  // Check MIME type
  if (!LOGO_VALIDATION.allowedMimeTypes.has(file.mimetype)) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "Only JPEG, PNG, and WebP image formats are supported",
    );
  }
};

/**
 * Validate image dimensions
 * @param filePath - Path to the image file
 * @throws AppError if dimensions are too small
 */
const validateImageDimensions = async (filePath: string) => {
  try {
    const metadata = await sharp(filePath).metadata();

    if (
      !metadata.width ||
      !metadata.height ||
      metadata.width < LOGO_VALIDATION.minWidth ||
      metadata.height < LOGO_VALIDATION.minHeight
    ) {
      throw new AppError(
        StatusCodes.BAD_REQUEST,
        `Image dimensions must be at least ${LOGO_VALIDATION.minWidth}x${LOGO_VALIDATION.minHeight}px`,
      );
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      "Failed to validate image dimensions",
    );
  }
};

/**
 * Extract logo filename from file path (relative path)
 * @param fullPath - Full file path from multer
 */
const getLogoRelativePath = (fullPath: string): string => {
  // Given multer stores files in /uploads/images/, return images/filename.webp
  const relativePath = fullPath.replace(/\\/g, "/").split("uploads/")[1];
  return relativePath || fullPath;
};

export { validateLogoFile, validateImageDimensions, getLogoRelativePath };
