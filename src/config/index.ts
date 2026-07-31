import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(process.cwd(), ".env") });

const requiredEnv = (name: string, value: string | undefined): string => {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

export default {
  app_name: process.env.APP_NAME,
  app_public_name: process.env.APP_PUBLIC_NAME,
  ip_address: process.env.IP_ADDRESS,
  database_url: requiredEnv("DATABASE_URL", process.env.DATABASE_URL),
  node_env: process.env.NODE_ENV,
  port: process.env.PORT,
  bcrypt_salt_rounds: Number(process.env.BCRYPT_SALT_ROUNDS) || 10,
  admin_secret_key: requiredEnv("ADMIN_SECRET_KEY", process.env.ADMIN_SECRET_KEY),
  jwt: {
    jwt_secret: requiredEnv("JWT_SECRET", process.env.JWT_SECRET),
    jwt_expire_in: process.env.JWT_EXPIRE_IN,
    jwt_refresh_secret: requiredEnv("JWT_REFRESH_SECRET", process.env.JWT_REFRESH_SECRET),
    jwt_refresh_expire_in: process.env.JWT_REFRESH_EXPIRE_IN,
    staff_permission_sync_seconds:
      process.env.JWT_STAFF_PERMISSION_SYNC_SECONDS,
  },
  database: {
    max_pool_size: process.env.DB_MAX_POOL_SIZE,
    server_selection_timeout_ms: process.env.DB_SERVER_SELECTION_TIMEOUT_MS,
    socket_timeout_ms: process.env.DB_SOCKET_TIMEOUT_MS,
    wait_queue_timeout_ms: process.env.DB_WAIT_QUEUE_TIMEOUT_MS,
    max_idle_time_ms: process.env.DB_MAX_IDLE_TIME_MS,
  },
  email: {
    from: process.env.EMAIL_FROM,
    user: process.env.EMAIL_USER,
    port: process.env.EMAIL_PORT,
    host: process.env.EMAIL_HOST,
    pass: process.env.EMAIL_PASS,
  },
  resend: {
    api_key: process.env.RESEND_API_KEY,
    mail_domain: process.env.MAIL_DOMAIN,
  },
  sms: {
    api_base_url:
      process.env.SMS_FASTSMSBD_API_BASE_URL || "https://smsapi.fastsmsbd.com",
    api_key: process.env.SMS_FASTSMSBD_API_KEY,
    sender_id: process.env.SMS_FASTSMSBD_SENDER_ID,
    dry_run: process.env.SMS_DRY_RUN !== "false",
    balance_cache_ttl_seconds: process.env.SMS_BALANCE_CACHE_TTL_SECONDS,
  },
  super_admin: {
    email: process.env.SUPER_ADMIN_EMAIL,
    password: process.env.SUPER_ADMIN_PASSWORD,
  },
  redis: {
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT,
    password: process.env.REDIS_PASSWORD,
  },
  google: {
    service_account_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY,
    default_range: process.env.GOOGLE_SHEET_DEFAULT_RANGE,
  },
  google_auth: {
    client_id: requiredEnv("GOOGLE_CLIENT_ID", process.env.GOOGLE_CLIENT_ID),
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
  },
  imports: {
    chunk_size: process.env.IMPORT_CHUNK_SIZE,
    max_preview_rows: process.env.IMPORT_MAX_PREVIEW_ROWS,
    max_failed_rows_data: process.env.IMPORT_MAX_FAILED_ROWS_DATA,
    max_rows_per_batch: process.env.IMPORT_MAX_ROWS_PER_BATCH,
  },
  minio: {
    endpoint: process.env.MINIO_ENDPOINT || "localhost",
    port: Number(process.env.MINIO_PORT) || 9000,
    access_key: requiredEnv("MINIO_ACCESS_KEY", process.env.MINIO_ACCESS_KEY),
    secret_key: requiredEnv("MINIO_SECRET_KEY", process.env.MINIO_SECRET_KEY),
    bucket: process.env.MINIO_BUCKET || "silvergym",
    use_ssl: process.env.MINIO_USE_SSL === "true",
    public_url: requiredEnv("MINIO_PUBLIC_URL", process.env.MINIO_PUBLIC_URL),
  },
};
