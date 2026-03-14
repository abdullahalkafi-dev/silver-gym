import mongoose from "mongoose";
import config from "../config";
import colors from "colors";
import { logger } from "../logger/logger";

const ConnectDB = async () => {
  await mongoose.connect(config.database_url as string, {
    maxPoolSize: 5,
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 30000,
    bufferCommands: false,
  });
  // await seedSuperAdmin();

  logger.info(colors.green('🚀 Database connected successfully'));

  
};
export default ConnectDB;
