import AppError from "errors/AppError";
import { StatusCodes } from "http-status-codes";
import sharp from "sharp";

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

const validateLogoFile = (file: Express.Multer.File | undefined) => {
  if (!file) return;

  if (file.size > LOGO_VALIDATION.maxSizeBytes) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      `Logo file size must not exceed ${LOGO_VALIDATION.maxSizeBytes / 1024 / 1024}MB`,
    );
  }

  if (!LOGO_VALIDATION.allowedMimeTypes.has(file.mimetype)) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "Only JPEG, PNG, and WebP image formats are supported",
    );
  }
};

const validateImageDimensions = async (buffer: Buffer) => {
  try {
    const metadata = await sharp(buffer).metadata();

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

export { validateLogoFile, validateImageDimensions };
