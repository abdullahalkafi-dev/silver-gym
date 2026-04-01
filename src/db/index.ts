import mongoose from "mongoose";
import config from "../config";
import { logger } from "../logger/logger";

const parsePositiveNumber = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const ConnectDB = async () => {
  mongoose.set("strictQuery", true);

  function setRunValidators() {
    return { runValidators: true };
  }

  mongoose.plugin((schema: any) => {
    schema.pre("findOneAndUpdate", setRunValidators);
    schema.pre("updateMany", setRunValidators);
    schema.pre("updateOne", setRunValidators);
    schema.pre("update", setRunValidators);
  });

  const maxPoolSize = parsePositiveNumber(config.database.max_pool_size, 5);
  const serverSelectionTimeoutMS = parsePositiveNumber(
    config.database.server_selection_timeout_ms,
    10000,
  );
  const socketTimeoutMS = parsePositiveNumber(config.database.socket_timeout_ms, 30000);
  const waitQueueTimeoutMS = parsePositiveNumber(
    config.database.wait_queue_timeout_ms,
    5000,
  );
  const maxIdleTimeMS = parsePositiveNumber(config.database.max_idle_time_ms, 10000);

  await mongoose.connect(config.database_url as string, {
    maxPoolSize,
    serverSelectionTimeoutMS,
    socketTimeoutMS,
    waitQueueTimeoutMS,
    maxIdleTimeMS,
    bufferCommands: false,
  });

  mongoose.connection.on("connected", () => {
    logger.info("MongoDB connected successfully");
  });

  mongoose.connection.on("disconnecting", () => {
    logger.info("MongoDB disconnecting...");
  });

  mongoose.connection.on("disconnected", () => {
    logger.info("MongoDB disconnected");
  });
};

export default ConnectDB;
