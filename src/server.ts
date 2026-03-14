import mongoose from "mongoose";
import http from "http";
import redisClient from "./redis/redisClient";
import app from "./app";
import config from "./config";
import { errorLogger, logger } from "./logger/logger";
import ConnectDB from "./db";

// ============ CREATE SERVER ============
const server = http.createServer(app);

// ============ GRACEFUL SHUTDOWN ============
async function gracefulShutdown(signal: string) {
  logger.info(`${signal} received. Starting graceful shutdown...`);

  // 1. Stop accepting new requests
  server.close(() => {
    logger.info("HTTP server closed");
  });

  try {
    // 2. Close Redis
    await redisClient.disconnect();
    logger.info("Redis disconnected");

    // 3. Close MongoDB
    await mongoose.connection.close();
    logger.info("MongoDB disconnected");

    logger.info("Graceful shutdown completed");
    process.exit(0);
  } catch (error) {
    errorLogger.error("Error during shutdown", {
      error: error instanceof Error ? error.message : error,
    });
    process.exit(1);
  }
}

// ============ PROCESS EVENT HANDLERS (register ONCE, outside main) ============

// Uncaught exceptions
process.on("uncaughtException", (error: Error) => {
  errorLogger.error("Uncaught Exception", {
    message: error.message,
    stack: error.stack,
  });
  // Give logger time to write, then exit
  setTimeout(() => process.exit(1), 1000);
});

// Unhandled promise rejections
process.on("unhandledRejection", (reason: unknown) => {
  errorLogger.error("Unhandled Rejection", {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
  // Give logger time to write, then exit
  setTimeout(() => process.exit(1), 1000);
});

// Graceful shutdown signals
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT")); // Ctrl+C

// ============ MAIN ============
async function main() {
  try {
    // 1. Connect MongoDB
    await ConnectDB();

    // 2. Seed admin
    // await seedSuperAdmin();

    // 3. Connect Redis
    await redisClient.connect();
    logger.info("Redis connected successfully");

    // 4. Start server
    const port = Number(config.port) || 5000;

    server.listen(port, "0.0.0.0", () => {
      logger.info(`Server listening on 0.0.0.0:${port}`);
      logger.info(`Environment: ${config.node_env}`);
    });
  } catch (error) {
    errorLogger.error("Failed to start server", {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    process.exit(1);
  }
}

main();

export { server };
