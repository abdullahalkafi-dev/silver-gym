import { NextFunction, Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import multer from "multer";
import sharp from "sharp";
import crypto from "crypto";

import AppError from "../../errors/AppError";
import { storage } from "../../shared/storage";

const ALLOWED = new Set([
  "image/jpeg",
  "image/png",
  "image/jpg",
  "image/webp",
  "image/heic",
  "image/heif",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (file.fieldname !== "image" || !ALLOWED.has(file.mimetype)) {
      cb(new AppError(StatusCodes.BAD_REQUEST, "Please upload a JPG, PNG or WEBP photo"));
      return;
    }
    cb(null, true);
  },
}).single("image");

/**
 * Member profile photo from the portal: max 5 MB, one image, stored under
 * `member-requests/` (not the live `images/` folder) until staff approve it.
 * Puts the stored object key on `req.pendingPhotoKey`.
 */
const portalPhotoUpload = (req: Request, res: Response, next: NextFunction) => {
  upload(req, res, async (err: unknown) => {
    if (err) {
      if ((err as any)?.code === "LIMIT_FILE_SIZE") {
        return next(new AppError(StatusCodes.BAD_REQUEST, "Photo must be 5 MB or smaller"));
      }
      return next(err);
    }

    if (!req.file) return next();

    try {
      const buffer = await sharp(req.file.buffer)
        .rotate()
        .resize({ width: 1024, withoutEnlargement: true })
        .webp({ quality: 60 })
        .toBuffer();

      const key = `member-requests/${Date.now()}-${crypto.randomBytes(6).toString("hex")}.webp`;
      await storage.upload(buffer, key, "image/webp");
      (req as any).pendingPhotoKey = key;
      next();
    } catch {
      next(new AppError(StatusCodes.BAD_REQUEST, "That photo could not be processed"));
    }
  });
};

export default portalPhotoUpload;
