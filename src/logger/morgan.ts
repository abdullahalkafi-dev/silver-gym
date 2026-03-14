import { Request, Response } from "express";
import morgan, { StreamOptions } from "morgan";
import config from "../config";
import { errorLogger, logger } from "./logger";



morgan.token(
  "message",
  (_req: Request, res: Response) => res?.locals?.errorMessage || ""
);

morgan.token(
  "body",
  (req: Request) => {
    if (req.method === "POST" || req.method === "PUT") {
      const body = { ...req.body };
      // Remove sensitive fields
      delete body.password;
      delete body.token;
      delete body.creditCard;
      return JSON.stringify(body);
    }
    return "";
  }
);

// ============ FORMAT ============

const getIpFormat = (): string =>
  config.node_env === "development" ? ":remote-addr - " : "";

const successFormat = `${getIpFormat()}:method :url :status - :response-time ms`;

// ✅ Include :message token for errors
const errorFormat = `${getIpFormat()}:method :url :status - :response-time ms - :message`;

// ============ STREAM OPTIONS ============

const successStream: StreamOptions = {
  write: (message: string) => logger.info(message.trim()),
};

const errorStream: StreamOptions = {
  write: (message: string) => errorLogger.error(message.trim()),
};

// ============ HANDLERS ============

const successHandler = morgan(successFormat, {
  skip: (_req: Request, res: Response) => res.statusCode >= 400,
  stream: successStream,
});

const errorHandler = morgan(errorFormat, {
  skip: (_req: Request, res: Response) => res.statusCode < 400,
  stream: errorStream,
});

// ============ EXPORT ============

export const Morgan = { errorHandler, successHandler };