import path from "path";
import DailyRotateFile from "winston-daily-rotate-file";
import { createLogger, format, transports } from "winston";
import config from "../config";

const { combine, timestamp, label, printf, errors } = format;

// ============ CONFIG ============
const LOG_DIR = path.join(process.cwd(), "logs");
const APP_NAME = config.app_name || "MyApp";
const IS_PRODUCTION = config.node_env === "production";

// ============ CUSTOM FORMAT ============
const myFormat = printf((info) => {
  const { level, message, label, timestamp, stack } = info;
  const date = new Date(timestamp as string);

  // Format date and time for Bangladesh Time (Asia/Dhaka) in 12-hour format
  const dateStr = date.toLocaleDateString("en-US", {
    timeZone: "Asia/Dhaka",
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  
  const timeStr = date.toLocaleTimeString("en-US", {
    timeZone: "Asia/Dhaka",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  
  // Include stack trace for errors
  const logMessage = stack || message;

  return `${dateStr} ${timeStr} [${label}] ${level}: ${logMessage}`;
});

// ============ SHARED FORMAT ============
const logFormat = combine(
  label({ label: APP_NAME }),
  timestamp(),
  errors({ stack: true }), // Capture stack traces
  myFormat
);

// ============ INFO LOGGER ============
const logger = createLogger({
  level: "info",
  format: logFormat,
  transports: [
    // Daily file rotation
    new DailyRotateFile({
      filename: path.join(LOG_DIR, "success", "%DATE%-success.log"),
      datePattern: "DD-MM-YYYY",   // ✅ Daily
      maxSize: "20m",
      maxFiles: "7d",              // ✅ Keep 7 days
      zippedArchive: true,         // ✅ Compress old logs
      level: "info",
    }),

    // Console only in development
    ...(IS_PRODUCTION
      ? []
      : [new transports.Console()]),
  ],

  // ✅ Catch uncaught exceptions
  exceptionHandlers: [
    new DailyRotateFile({
      filename: path.join(LOG_DIR, "exceptions", "%DATE%-exceptions.log"),
      datePattern: "DD-MM-YYYY",
      maxSize: "20m",
      maxFiles: "14d",
      zippedArchive: true,
    }),
  ],

  // ✅ Catch unhandled promise rejections
  rejectionHandlers: [
    new DailyRotateFile({
      filename: path.join(LOG_DIR, "rejections", "%DATE%-rejections.log"),
      datePattern: "DD-MM-YYYY",
      maxSize: "20m",
      maxFiles: "14d",
      zippedArchive: true,
    }),
  ],
});

// ============ ERROR LOGGER ============
const errorLogger = createLogger({
  level: "error",
  format: logFormat,
  transports: [
    new DailyRotateFile({
      filename: path.join(LOG_DIR, "error", "%DATE%-error.log"),
      datePattern: "DD-MM-YYYY",   // ✅ Daily
      maxSize: "20m",
      maxFiles: "14d",             // ✅ Keep 14 days (errors are important)
      zippedArchive: true,         // ✅ Compress old logs
    }),

    ...(IS_PRODUCTION
      ? []
      : [new transports.Console()]),
  ],
});

export { errorLogger, logger };