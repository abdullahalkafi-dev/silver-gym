import { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import AppError from "../errors/AppError";
import handleCastError from "../errors/handleCastError";
import handleDuplicateError from "../errors/handleDuplicateError";
import handleValidationError from "../errors/handleValidationError";
import handleZodError from "../errors/handleZodError";

import config from "../config";
import { errorLogger } from "../logger/logger";
import { TErrorSources } from "../types/error";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const globalErrorHandler: ErrorRequestHandler = (err, req, res, _next): any => {
  let statusCode = 500;
  let message = "Something went wrong!";
  let errorSources: TErrorSources = [
    {
      path: "",
      message: "Something went wrong",
    },
  ];

  if (err instanceof ZodError) {
    const simplifiedError = handleZodError(err);
    statusCode = simplifiedError?.statusCode;
    message = simplifiedError?.message;
    errorSources = simplifiedError?.errorSources;
  } else if (err?.name === "ValidationError") {
    console.log(err);
    const simplifiedError = handleValidationError(err);
    statusCode = simplifiedError?.statusCode;
    message = simplifiedError?.message;
    errorSources = simplifiedError?.errorSources;
  } else if (err?.name === "CastError") {
    const simplifiedError = handleCastError(err);
    statusCode = simplifiedError?.statusCode;
    message = simplifiedError?.message;
    errorSources = simplifiedError?.errorSources;
  } else if (err?.code === 11000) {
    const simplifiedError = handleDuplicateError(err);
    statusCode = simplifiedError?.statusCode;
    message = simplifiedError?.message;
    errorSources = simplifiedError?.errorSources;
  } else if (err?.name === "TokenExpiredError") {
    statusCode = 401;
    message = "Your session has expired. Please login again.";
    errorSources = [
      {
        path: "",
        message: "JWT token has expired",
      },
    ];
  } else if (err?.name === "JsonWebTokenError") {
    statusCode = 401;
    message = "Invalid token. Please login again.";
    errorSources = [
      {
        path: "",
        message: "Invalid JWT token",
      },
    ];
  } else if (err instanceof AppError) {
    statusCode = err?.statusCode;
    message = err.message;
    errorSources = [
      {
        path: "",
        message: err?.message,
      },
    ];
  } else if (err instanceof Error) {
    message = err.message;
    errorSources = [
      {
        path: "",
        message: err?.message,
      },
    ];
  }
  // for morgan
  res.locals.errorMessage = err.message;

  errorLogger.error(`${req.method} ${req.originalUrl} → ${message}`, {
    errorSources,
    stack: err?.stack,
    // Only in development
    ...(config.node_env === "development" && {
      body: req.body,
      params: req.params,
      query: req.query,
    }),
  });
  //ultimate return
  return res.status(statusCode).json({
    success: false,
    message,
    errorSources,
    err,
    stack: config.node_env === "development" ? err?.stack : null,
  });
};

export default globalErrorHandler;
