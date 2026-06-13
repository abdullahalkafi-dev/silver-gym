import { Client } from "minio";
import config from "./index";

const minioClient = new Client({
  endPoint: config.minio.endpoint,
  port: config.minio.port,
  useSSL: config.minio.use_ssl,
  accessKey: config.minio.access_key,
  secretKey: config.minio.secret_key,
  pathStyle: true,
});

export default minioClient;
