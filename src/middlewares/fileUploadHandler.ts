import { Request, Response, NextFunction } from "express";
import fs from "fs";
import { StatusCodes } from "http-status-codes";
import multer, { FileFilterCallback } from "multer";
import path from "path";
import AppError from "../errors/AppError";
import sharp from "sharp";
import generateUploadFileName from "../util/generateUploadFileName";

type UploadField = "image" | "media" | "doc" | "docs";

const BASE_UPLOAD_DIR = path.join(process.cwd(), "uploads");

const FIELD_CONFIG: Record<
  UploadField,
  { folder: string; maxCount: number; forcedExtension?: string }
> = {
  image: { folder: "images", maxCount: 10, forcedExtension: ".tmp" },
  media: { folder: "medias", maxCount: 10 },
  doc: { folder: "docs", maxCount: 10, forcedExtension: ".pdf" },
  docs: { folder: "docs", maxCount: 10, forcedExtension: ".pdf" },
};

const ALLOWED_MIME_TYPES: Record<UploadField, Set<string>> = {
  image: new Set([
    "image/jpeg",
    "image/png",
    "image/jpg",
    "image/heif",
    "image/heic",
    "image/tiff",
    "image/webp",
    "image/avif",
  ]),
  media: new Set(["video/mp4", "audio/mpeg"]),
  doc: new Set(["application/pdf"]),
  docs: new Set(["application/pdf"]),
};

const ALLOWED_MIME_MESSAGES: Record<UploadField, string> = {
  image: "Only .jpeg, .png, .jpg, .heif, .heic, .tiff, .webp, .avif files supported",
  media: "Only .mp4, .mp3 file supported",
  doc: "Only pdf supported",
  docs: "Only pdf supported",
};

const SUPPORTED_FIELDS = Object.keys(FIELD_CONFIG) as UploadField[];

const ensureDirExists = (dirPath: string) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

const isUploadField = (value: string): value is UploadField => {
  return value in FIELD_CONFIG;
};

const fileUploadHandler = (req: Request, res: Response, next: NextFunction) => {
  ensureDirExists(BASE_UPLOAD_DIR);

  const storage = multer.diskStorage({
    destination: (_req, file, cb) => {
      if (!isUploadField(file.fieldname)) {
        cb(new AppError(StatusCodes.BAD_REQUEST, "File is not supported"), "");
        return;
      }

      const uploadDir = path.join(BASE_UPLOAD_DIR, FIELD_CONFIG[file.fieldname].folder);
      ensureDirExists(uploadDir);
      cb(null, uploadDir);
    },

    filename: (req, file, cb) => {
      if (!isUploadField(file.fieldname)) {
        cb(new AppError(StatusCodes.BAD_REQUEST, "This file is not supported"), "");
        return;
      }

      const extension =
        FIELD_CONFIG[file.fieldname].forcedExtension ??
        path.extname(file.originalname).toLowerCase();
      const useUserId =
        file.fieldname === "image" && req.url === "/update-profile" && !!req.user?._id;

      const fileName = generateUploadFileName({
        originalName: file.originalname,
        userId: useUserId ? String(req.user?._id) : undefined,
      });

      cb(null, `${fileName}${extension}`);
    },
  });

  const fileFilter = (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    if (!isUploadField(file.fieldname)) {
      cb(new AppError(StatusCodes.BAD_REQUEST, "This file is not supported"));
      return;
    }

    const isAllowedMime = ALLOWED_MIME_TYPES[file.fieldname].has(file.mimetype);
    if (!isAllowedMime) {
      cb(new AppError(StatusCodes.BAD_REQUEST, ALLOWED_MIME_MESSAGES[file.fieldname]));
      return;
    }

    cb(null, true);
  };

  const upload = multer({
    storage,
    fileFilter,
  }).fields(
    SUPPORTED_FIELDS.map((fieldName) => ({
      name: fieldName,
      maxCount: FIELD_CONFIG[fieldName].maxCount,
    })),
  );

  upload(req, res, async (err: unknown) => {
    if (err) {
      return next(err);
    }

    const uploadedFiles = req.files as Record<string, Express.Multer.File[]> | undefined;
    const imageFiles = uploadedFiles?.image;

    if (!imageFiles || imageFiles.length === 0) {
      return next();
    }

    try {
      for (const file of imageFiles) {
        const inputFilePath = file.path;
        const newFilePath = inputFilePath.replace(/\.tmp$/, ".webp");

        await sharp(inputFilePath)
          .resize({ width: 1024 })
          .webp({ quality: 40, effort: 6, nearLossless: false })
          .toFile(newFilePath);

        await fs.promises.unlink(inputFilePath);

        file.path = newFilePath;
        file.filename = path.basename(newFilePath);
      }
    } catch {
      return next(
        new AppError(StatusCodes.INTERNAL_SERVER_ERROR, "Image processing failed"),
      );
    }

    next();
  });
};

export default fileUploadHandler;
