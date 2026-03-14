import { Request, Response, NextFunction } from "express";
import fs from "fs";
import { StatusCodes } from "http-status-codes";
import multer, { FileFilterCallback } from "multer";
import path from "path";
import AppError from "../errors/AppError";
import sharp from "sharp";

const randomCode = () => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz123456789";
  let result = "";
  for (let i = 0; i < 5; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

const fileUploadHandler = (req: Request, res: Response, next: NextFunction) => {
  // Create upload folder
  const baseUploadDir = path.join(process.cwd(), "uploads");
  if (!fs.existsSync(baseUploadDir)) {
    fs.mkdirSync(baseUploadDir);
  }

  // Folder create for different file
  const createDir = (dirPath: string) => {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath);
    }
  };

  // Create filename
  const storage = multer.diskStorage({
    destination: (_req, file, cb) => {
      let uploadDir;
      console.log(file.fieldname);
      switch (file.fieldname) {
        case "image":
          uploadDir = path.join(baseUploadDir, "images");
          break;
        case "media":
          uploadDir = path.join(baseUploadDir, "medias");
          break;
        case "doc":
        case "docs":
          uploadDir = path.join(baseUploadDir, "docs");
          break;
        default:
          throw new AppError(StatusCodes.BAD_REQUEST, "File is not supported");
      }
      createDir(uploadDir);
      cb(null, uploadDir);
    },

    filename: (req, file, cb) => {
      let fileExt: string;
      if (file.fieldname === "doc" || file.fieldname === "docs") {
        fileExt = ".pdf";
      } else if (file.fieldname === "image") {
        fileExt = ".tmp"; // will be converted to .webp later
      } else {
        // For media, retain the original extension
        fileExt = path.extname(file.originalname);
      }
      const date = new Date();
      const formattedDate = `${date.getDate()}-${
        date.getMonth() + 1
      }-${date.getFullYear()}`;

      const originalNameWithoutExt =
        path.parse(file.originalname).name + "-" + randomCode();
      const fileName =
        req?.user?._id &&
        req.url === "/update-profile" &&
        file.fieldname == "image"
          ? req.user._id + "-" + originalNameWithoutExt
          : originalNameWithoutExt.toLowerCase().split(" ").join("-") +
            "-" +
            formattedDate;

      cb(null, fileName + fileExt);
    },
  });

  // File filter
  const filterFilter = (_req: Request, file: any, cb: FileFilterCallback) => {
    if (file.fieldname === "image") {
      if (
        file.mimetype === "image/jpeg" ||
        file.mimetype === "image/png" ||
        file.mimetype === "image/jpg" ||
        file.mimetype === "image/heif" ||
        file.mimetype === "image/heic" ||
        file.mimetype === "image/tiff" ||
        file.mimetype === "image/webp" ||
        file.mimetype === "image/avif"
      ) {
        cb(null, true);
      } else {
        console.log(file.fieldname);
        console.log(file.mimetype);
        cb(
          new AppError(
            StatusCodes.BAD_REQUEST,
            "Only .jpeg, .png, .jpg, .heif, .heic, .tiff, .webp, .avif files supported",
          ),
        );
      }
    } else if (file.fieldname === "media") {
      if (file.mimetype === "video/mp4" || file.mimetype === "audio/mpeg") {
        cb(null, true);
      } else {
        cb(
          new AppError(
            StatusCodes.BAD_REQUEST,
            "Only .mp4, .mp3, file supported",
          ),
        );
      }
    } else if (file.fieldname === "doc" || file.fieldname === "docs") {
      if (file.mimetype === "application/pdf") {
        cb(null, true);
      } else {
        cb(new AppError(StatusCodes.BAD_REQUEST, "Only pdf supported"));
      }
    } else {
      throw new AppError(StatusCodes.BAD_REQUEST, "This file is not supported");
    }
  };

  // Return multer middleware
  const upload = multer({
    storage: storage,
    fileFilter: filterFilter,
  }).fields([
    { name: "image", maxCount: 10 },
    { name: "media", maxCount: 10 },
    { name: "doc", maxCount: 10 },
  ]);
  // Execute the multer middleware
  upload(req, res, async (err: any) => {
    if (err) {
      return next(err);
    }

    // Post-process image files: convert to WebP and compress.
    if (req.files && "image" in req.files) {
      const imageFiles = (
        req.files as { [fieldname: string]: Express.Multer.File[] }
      )["image"] as Express.Multer.File[];
      try {
        // Loop through each image file uploaded
        for (const file of imageFiles) {
          const inputFilePath = file.path;
          // Create new filename by replacing .tmp with .webp
          const newFilePath = inputFilePath.replace(/\.tmp$/, ".webp");

          await sharp(inputFilePath)
            .resize({ width: 1024 })
            .webp({ quality: 40, effort: 6, nearLossless: false })
            .toFile(newFilePath);

          // Remove the temporary file
          fs.unlinkSync(inputFilePath);

          // Update file metadata if needed for later middlewares
          file.path = newFilePath;
          file.filename = path.basename(newFilePath);
        }
      } catch (error) {
        return next(
          new AppError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            "Image processing failed",
          ),
        );
      }
    }

    next();
  });
};

export default fileUploadHandler;
