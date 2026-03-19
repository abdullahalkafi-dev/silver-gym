import helmet from "helmet";
import rateLimit from "express-rate-limit";
import mongoSanitize from "express-mongo-sanitize";
import compression from "compression";
import { Request, Response, NextFunction, RequestHandler } from "express";
import { logger } from "../logger/logger";

// ============ HELMET ============
export const helmetConfig = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
});

// ============ RATE LIMITERS ============
export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: {
    success: false,
    message: "Too many requests, please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: {
    success: false,
    message: "Too many authentication attempts, please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
});

export const strictLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: {
    success: false,
    message: "Too many requests for this operation.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// ============ MONGO SANITIZE ============
export const sanitizeInput: RequestHandler = mongoSanitize({
  replaceWith: "_",
  onSanitize: ({ req, key }: { req: Request; key: string }) => {
    logger.warn(`MongoDB injection attempt from ${req.ip}: ${key}`);
  },
}) as RequestHandler;

// ============ COMPRESSION ============
export const compressionConfig: RequestHandler = compression({
  filter: (req: Request, res: Response) => {
    if (req.headers["x-no-compression"]) {
      return false;
    }
    return compression.filter(req, res);
  },
  threshold: 1024,
  level: 1, 
}) as RequestHandler;

// ============ INPUT SANITIZATION (XSS only, NOT Mongo) ============
export const additionalSanitization = (
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  // ✅ Only sanitize XSS - MongoDB injection handled by mongoSanitize
  const sanitizeString = (str: string): string => {
    return str
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
      .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "")
      .replace(/javascript:/gi, "")
      .replace(/on\w+\s*=/gi, "");
  };

  const sanitizeObject = (obj: any): any => {
    if (typeof obj === "string") return sanitizeString(obj);
    if (Array.isArray(obj)) return obj.map(sanitizeObject);
    if (obj && typeof obj === "object") {
      const sanitized: any = {};
      for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          // ✅ Only sanitize keys starting with $ (MongoDB operators)
          if (key.startsWith("$")) {
            logger.warn(
              `Suspicious key "${key}" in request body from ${req.ip}`
            );
            continue; // Skip this key entirely
          }
          sanitized[key] = sanitizeObject(obj[key]);
        }
      }
      return sanitized;
    }
    return obj;
  };

  if (req.body) {
    try {
      req.body = sanitizeObject(req.body);
    } catch (error) {
      logger.warn("Error sanitizing request body");
    }
  }

  next();
};
