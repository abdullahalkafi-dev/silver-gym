import mongoose from "mongoose";
import config from "../config";
import { logger } from "../logger/logger";

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

  await mongoose.connect(config.database_url as string, {
    maxPoolSize: 5,
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 30000,
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
