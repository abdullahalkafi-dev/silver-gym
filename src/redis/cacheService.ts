import redisClient from "./redisClient";
import { promisify } from "util";
import { deflate, inflate } from "zlib";

// Promisify zlib methods
const deflateAsync = promisify(deflate);
const inflateAsync = promisify(inflate);

class CacheService {
  private readonly COMPRESSION_THRESHOLD = 1024; // 1KB
  private readonly MAX_CACHE_SIZE = 10 * 1024 * 1024; // 10MB
  private readonly COMPRESSED_PREFIX = "GZ:";

  // ============ COMPRESSION (zlib built-in) ============

  private async compress(data: string): Promise<string> {
    const buffer = Buffer.from(data, "utf-8");

    // Use deflate (faster than gzip, no headers)
    const compressed = await deflateAsync(buffer, {
      level: 1, // 1 = fastest compression (best for cache)
    });

    return this.COMPRESSED_PREFIX + compressed.toString("base64");
  }

  private async decompress(data: string): Promise<string> {
    if (!data.startsWith(this.COMPRESSED_PREFIX)) {
      return data; // Not compressed
    }

    const compressedData = data.slice(this.COMPRESSED_PREFIX.length);
    const buffer = Buffer.from(compressedData, "base64");
    const decompressed = await inflateAsync(buffer);
    return decompressed.toString("utf-8");
  }

  private isCompressed(data: string): boolean {
    return data.startsWith(this.COMPRESSED_PREFIX);
  }

  // ============ CORE METHODS ============

  async setCache(
    key: string,
    value: any,
    expiryInSec: number = 3600
  ): Promise<void> {
    try {
      const stringifiedValue = JSON.stringify(value);
      let finalValue: string;

      if (stringifiedValue.length > this.COMPRESSION_THRESHOLD) {
        finalValue = await this.compress(stringifiedValue);

        const savings = (
          ((stringifiedValue.length - finalValue.length) /
            stringifiedValue.length) *
          100
        ).toFixed(1);

        console.log(
          `Compressed: ${key} | ${stringifiedValue.length}B → ${finalValue.length}B | Saved ${savings}%`
        );
      } else {
        finalValue = stringifiedValue;
      }

      if (finalValue.length > this.MAX_CACHE_SIZE) {
        console.warn(`Cache too large, skipping: ${key}`);
        return;
      }

      await redisClient.set(key, finalValue, expiryInSec);
    } catch (error) {
      console.error(`Cache set error for key ${key}:`, error);
      throw error;
    }
  }

  async getCache<T>(key: string): Promise<T | null> {
    try {
      const startTime = Date.now();
      const data = await redisClient.get(key);
      const duration = Date.now() - startTime;

      if (duration > 100) {
        console.warn(`Slow cache get: ${key} took ${duration}ms`);
      }

      if (data) {
        const decompressed = await this.decompress(data);
        return JSON.parse(decompressed) as T;
      }

      return null;
    } catch (error) {
      console.error(`Cache get error for key ${key}:`, error);
      return null;
    }
  }

  async getMultipleCache<T>(
    keys: string[]
  ): Promise<Map<string, T | null>> {
    const result = new Map<string, T | null>();
    if (keys.length === 0) return result;

    try {
      const startTime = Date.now();
      const pipeline = redisClient.client.multi();
      keys.forEach((key) => pipeline.get(key));
      const results = await pipeline.exec();
      const duration = Date.now() - startTime;

      if (duration > 100) {
        console.warn(
          `Slow batch get: ${keys.length} keys took ${duration}ms`
        );
      }

      await Promise.all(
        keys.map(async (key, index) => {
          const data = results?.[index];
          if (data && typeof data === "string") {
            try {
              const decompressed = await this.decompress(data);
              result.set(key, JSON.parse(decompressed) as T);
            } catch {
              result.set(key, null);
            }
          } else {
            result.set(key, null);
          }
        })
      );
    } catch (error) {
      console.error("Batch cache get error:", error);
      keys.forEach((key) => result.set(key, null));
    }

    return result;
  }

  async deleteCache(key: string): Promise<void> {
    try {
      await redisClient.delete(key);
    } catch (error) {
      console.error(`Cache delete error for key ${key}:`, error);
      throw error;
    }
  }

  async invalidateByPattern(pattern: string): Promise<void> {
    try {
      const keys: string[] = [];
      let cursor = 0;

      do {
        const reply = await redisClient.client.scan(String(cursor), {
          MATCH: pattern,
          COUNT: 100,
        });
        cursor = Number(reply.cursor);
        keys.push(...reply.keys);
      } while (cursor !== 0);

      if (keys.length > 0) {
        const batchSize = 100;
        for (let i = 0; i < keys.length; i += batchSize) {
          const batch = keys.slice(i, i + batchSize);
          const pipeline = redisClient.client.multi();
          batch.forEach((key) => pipeline.del(key));
          await pipeline.exec();
        }
      }
    } catch (error) {
      console.warn(`Error invalidating pattern ${pattern}:`, error);
      throw error;
    }
  }

  async getCacheStats(key: string) {
    const data = await redisClient.get(key);
    return {
      exists: data !== null,
      compressed: data ? this.isCompressed(data) : false,
      sizeBytes: data ? Buffer.byteLength(data) : 0,
    };
  }

  async healthCheck(): Promise<boolean> {
    return await redisClient.healthCheck();
  }
}

export default new CacheService();