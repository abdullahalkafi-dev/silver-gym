import crypto from "crypto";
import path from "path";

type GenerateUploadFileNameOptions = {
  originalName: string;
  userId?: string;
  now?: Date;
};

const toSlug = (value: string): string => {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "file";
};

export const generateRandomString = (length = 10): string => {
  const safeLength = Math.max(4, length);
  return crypto.randomBytes(Math.ceil(safeLength / 2)).toString("hex").slice(0, safeLength);
};

const generateUploadFileName = ({
  originalName,
  userId,
  now = new Date(),
}: GenerateUploadFileNameOptions): string => {
  const baseName = toSlug(path.parse(originalName).name);
  const datePart = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const randomPart = generateRandomString(8);

  if (userId) {
    return `${userId}-${baseName}-${randomPart}`;
  }

  return `${baseName}-${datePart}-${randomPart}`;
};

export default generateUploadFileName;
