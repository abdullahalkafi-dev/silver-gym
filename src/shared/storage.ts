import minioClient from "../config/minio";
import config from "../config";

const BUCKET = config.minio.bucket;
const PUBLIC_URL = config.minio.public_url;

const ensureBucket = async (): Promise<void> => {
  const exists = await minioClient.bucketExists(BUCKET);
  if (!exists) {
    await minioClient.makeBucket(BUCKET);
  }
};

const upload = async (
  file: Buffer,
  key: string,
  contentType: string,
): Promise<string> => {
  await ensureBucket();

  await minioClient.putObject(BUCKET, key, file, file.length, {
    "Content-Type": contentType,
  });

  return key;
};

const remove = async (key: string): Promise<void> => {
  try {
    await minioClient.removeObject(BUCKET, key);
  } catch {
    // File doesn't exist or already deleted — non-critical
  }
};

const getUrl = (key: string): string => {
  return `${PUBLIC_URL}/${key.replace(/^\/+/, "")}`;
};

const getObjectKey = (fullPath: string): string => {
  const normalized = fullPath.replace(/\\/g, "/");
  const parts = normalized.split("uploads/");
  if (parts[1]) {
    return parts[1];
  }
  return normalized.replace(/^\/+/, "");
};

export const storage = {
  upload,
  remove,
  getUrl,
  getObjectKey,
};
