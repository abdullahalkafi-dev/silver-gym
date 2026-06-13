import { Request, Response, NextFunction } from "express";
import { StatusCodes } from "http-status-codes";
import multer, { FileFilterCallback } from "multer";
import path from "path";
import AppError from "../errors/AppError";
import sharp from "sharp";
import generateUploadFileName from "../utils/generateUploadFileName";
import { storage } from "../shared/storage";

type UploadField = "image" | "media" | "doc" | "docs" | "csv";

const FIELD_CONFIG: Record<
  UploadField,
  { folder: string; maxCount: number; forcedExtension?: string; contentType?: string }
> = {
  image: { folder: "images", maxCount: 10, forcedExtension: ".tmp" },
  media: { folder: "medias", maxCount: 10 },
  doc: { folder: "docs", maxCount: 10, forcedExtension: ".pdf", contentType: "application/pdf" },
  docs: { folder: "docs", maxCount: 10, forcedExtension: ".pdf", contentType: "application/pdf" },
  csv: { folder: "csvs", maxCount: 1 },
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
  csv: new Set(["text/csv", "application/vnd.ms-excel", "text/plain", "application/octet-stream", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]),
};

const ALLOWED_MIME_MESSAGES: Record<UploadField, string> = {
  image: "Only .jpeg, .png, .jpg, .heif, .heic, .tiff, .webp, .avif files supported",
  media: "Only .mp4, .mp3 file supported",
  doc: "Only pdf supported",
  docs: "Only pdf supported",
  csv: "Only .csv and .xlsx files are supported",
};

const SUPPORTED_FIELDS = Object.keys(FIELD_CONFIG) as UploadField[];

const isUploadField = (value: string): value is UploadField => {
  return value in FIELD_CONFIG;
};

const fileUploadHandler = async (req: Request, res: Response, next: NextFunction) => {
  const storage_engine = multer.memoryStorage();

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
    storage: storage_engine,
    fileFilter,
    limits: { fileSize: 100 * 1024 * 1024 },
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

    if (!uploadedFiles) {
      return next();
    }

    try {
      // Process and upload all files to MinIO
      for (const fieldName of SUPPORTED_FIELDS) {
        const files = uploadedFiles[fieldName];
        if (!files || files.length === 0) continue;

        await Promise.all(
          files.map(async (file) => {
            if (!isUploadField(file.fieldname)) return;

            const config = FIELD_CONFIG[file.fieldname];
            const useUserId =
              file.fieldname === "image" && req.url === "/update-profile" && !!req.user?._id;

            const fileName = generateUploadFileName({
              originalName: file.originalname,
              userId: useUserId ? String(req.user?._id) : undefined,
            });

            let uploadBuffer: Buffer;
            let objectKey: string;
            let contentType: string;

            if (file.fieldname === "image") {
              // Compress image with sharp before upload
              uploadBuffer = await sharp(file.buffer)
                .resize({ width: 1024 })
                .webp({ quality: 40, effort: 6, nearLossless: false })
                .toBuffer();

              objectKey = `${config.folder}/${fileName}.webp`;
              contentType = "image/webp";
            } else {
              uploadBuffer = file.buffer;
              const extension =
                config.forcedExtension ?? path.extname(file.originalname).toLowerCase();
              objectKey = `${config.folder}/${fileName}${extension}`;
              contentType = config.contentType ?? file.mimetype;
            }

            await storage.upload(uploadBuffer, objectKey, contentType);

            // Set file.path to the object key so downstream services can use it
            file.path = objectKey;
            file.filename = path.basename(objectKey);
          }),
        );
      }
    } catch (processingError) {
      return next(
        new AppError(StatusCodes.INTERNAL_SERVER_ERROR, "File processing failed"),
      );
    }

    next();
  });
};

export default fileUploadHandler;
