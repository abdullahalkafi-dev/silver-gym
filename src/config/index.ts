import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(process.cwd(), ".env") });

export default {
  app_name: process.env.APP_NAME,
  app_public_name: process.env.APP_PUBLIC_NAME,
  ip_address: process.env.IP_ADDRESS,
  database_url: process.env.DATABASE_URL,
  node_env: process.env.NODE_ENV,
  port: process.env.PORT,
  bcrypt_salt_rounds: process.env.BCRYPT_SALT_ROUNDS,
  admin_secret_key: process.env.ADMIN_SECRET_KEY,
  jwt: {
    jwt_secret: process.env.JWT_SECRET,
    jwt_expire_in: process.env.JWT_EXPIRE_IN,
    jwt_refresh_secret: process.env.JWT_REFRESH_SECRET,
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
  imports: {
    chunk_size: process.env.IMPORT_CHUNK_SIZE,
    max_preview_rows: process.env.IMPORT_MAX_PREVIEW_ROWS,
    max_failed_rows_data: process.env.IMPORT_MAX_FAILED_ROWS_DATA,
    max_rows_per_batch: process.env.IMPORT_MAX_ROWS_PER_BATCH,
  },


};
