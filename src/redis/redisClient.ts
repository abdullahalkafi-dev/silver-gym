import { createClient, RedisClientType } from "redis";
import config from "../config";

class RedisClient {
  private clientInstance: RedisClientType;
  private isConnected: boolean = false;
  private connectionPromise: Promise<void> | null = null;
  private retryCount: number = 0;
  private maxRetries: number = 3;
  private retryDelay: number = 1000; // 1 second

  constructor() {
    this.clientInstance = createClient({
      url:
        process.env.REDIS_URL ||
        `redis://${config.redis.host}:${config.redis.port}`,
      password: config.redis.password || undefined,
      socket: {
        connectTimeout: 5000, // Reduced from 60 seconds
        noDelay: true, // Disable Nagle's algorithm for lower latency
        reconnectStrategy: (retries: number) => {
          this.retryCount = retries;
          console.warn(
            `Redis reconnection attempt ${this.retryCount}/${this.maxRetries}`
          );

          if (this.retryCount > this.maxRetries) {
            console.error("Redis max reconnection attempts reached");
            return false; // Stop reconnecting
          }

          // Exponential backoff using configured base delay, max 5 seconds.
          return Math.min(this.retryCount * this.retryDelay, 5000);
        },
      },
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.clientInstance.on("error", (err: Error) => {
      console.error("Redis Client Error:", err);
      this.isConnected = false;
    });

    this.clientInstance.on("connect", () => {
      console.log("Redis client connected");
      this.isConnected = true;
      this.retryCount = 0;
    });

    this.clientInstance.on("disconnect", () => {
      console.log("Redis client disconnected");
      this.isConnected = false;
    });

    this.clientInstance.on("ready", () => {
      console.log("Redis client ready");
      this.isConnected = true;
    });

    this.clientInstance.on("end", () => {
      console.log("Redis client connection ended");
      this.isConnected = false;
    });
  }

  // Getter for the client instance
  get client(): RedisClientType {
    return this.clientInstance;
  }

  async connect(): Promise<void> {
    if (this.isConnected) return;

    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    this.connectionPromise = this.attemptConnection();

    try {
      await this.connectionPromise;
    } finally {
      this.connectionPromise = null;
    }
  }

  private async attemptConnection(): Promise<void> {
    try {
      await this.clientInstance.connect();
      console.log("Connected to Redis");
    } catch (error) {
      console.error("Failed to connect to Redis:", error);
      throw error;
    }
  }

  async ensureConnected(): Promise<void> {
    if (!this.isConnected) {
      await this.connect();
    }
  }

  async disconnect(): Promise<void> {
    if (this.isConnected) {
      await this.clientInstance.disconnect();
      this.isConnected = false;
    }
  }

  // Health check method
  async healthCheck(): Promise<boolean> {
    try {
      await this.ensureConnected();
      await this.clientInstance.ping();
      return true;
    } catch (error) {
      console.error("Redis health check failed:", error);
      return false;
    }
  }

  async set(
    key: string,
    value: string,
    expiryInSec: number = 3600,
  ): Promise<void> {
    try {
      // Only ensure connection if not already connected
      if (!this.isConnected) {
        await this.ensureConnected();
      }
      await this.clientInstance.setEx(key, expiryInSec, value);
    } catch (err) {
      console.error(`Error setting key ${key}:`, err);
      throw err;
    }
  }

  async get(key: string): Promise<string | null> {
    try {
      // Only ensure connection if not already connected
      if (!this.isConnected) {
        await this.ensureConnected();
      }
      return await this.clientInstance.get(key);
    } catch (err) {
      console.error(`Error getting key ${key}:`, err);
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      // Only ensure connection if not already connected
      if (!this.isConnected) {
        await this.ensureConnected();
      }
      await this.clientInstance.del(key);
    } catch (err) {
      console.error(`Error deleting key ${key}:`, err);
      throw err;
    }
  }

  async keys(pattern: string): Promise<string[]> {
    try {
      // Only ensure connection if not already connected
      if (!this.isConnected) {
        await this.ensureConnected();
      }
      return await this.clientInstance.keys(pattern);
    } catch (err) {
      console.error(`Error getting keys with pattern ${pattern}:`, err);
      throw err;
    }
  }

  // Graceful shutdown
  async gracefulShutdown(): Promise<void> {
    console.log("Shutting down Redis connection...");
    await this.disconnect();
  }
}

const redisClient = new RedisClient();

// Graceful shutdown handling
process.on("SIGINT", async () => {
  await redisClient.gracefulShutdown();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await redisClient.gracefulShutdown();
  process.exit(0);
});

export default redisClient;
