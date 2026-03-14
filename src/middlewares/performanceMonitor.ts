import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { logger } from "../logger/logger";

// ============ TYPES ============
interface LightMetric {
  endpoint: string;
  method: string;
  responseTime: number;
  statusCode: number;
  timestamp: number; 
}

interface EndpointStat {
  count: number;
  totalTime: number;
  errors: number;
  slowRequests: number;
  averageTime?: number;
  errorRate?: number;
}

// ============ PERFORMANCE MONITOR ============
class PerformanceMonitor {
  private metrics: LightMetric[] = [];
  private readonly slowRequestThreshold = 1000;
  private readonly maxMetricsSize = 500;

  requestMonitor() {
    return (req: Request, res: Response, next: NextFunction) => {
      const startTime = Date.now();

     
      res.on("finish", () => {
        const responseTime = Date.now() - startTime;

      
        this.addMetric({
          endpoint: req.route?.path || req.path,
          method: req.method,
          responseTime,
          statusCode: res.statusCode,
          timestamp: Date.now(),
        });

        // Log slow requests
        if (responseTime > this.slowRequestThreshold) {
          logger.warn(
            `Slow request: ${req.method} ${req.path} took ${responseTime}ms`
          );
        }
      });

      next();
    };
  }

  addMetric(metric: LightMetric) {
    this.metrics.push(metric);

    // ✅ More efficient cleanup
    if (this.metrics.length > this.maxMetricsSize) {
      this.metrics = this.metrics.slice(-Math.floor(this.maxMetricsSize / 2));
    }
  }

  getStats(timeWindow: number = 3600000) {
    const cutoff = Date.now() - timeWindow;
    const recentMetrics = this.metrics.filter(
      (m) => m.timestamp > cutoff
    );

    if (recentMetrics.length === 0) {
      return {
        totalRequests: 0,
        averageResponseTime: 0,
        slowRequests: 0,
        errorRate: 0,
        endpointStats: {},
      };
    }

    const totalRequests = recentMetrics.length;
    const averageResponseTime = Math.round(
      recentMetrics.reduce((sum, m) => sum + m.responseTime, 0) /
        totalRequests
    );
    const slowRequests = recentMetrics.filter(
      (m) => m.responseTime > this.slowRequestThreshold
    ).length;
    const errorRequests = recentMetrics.filter(
      (m) => m.statusCode >= 400
    ).length;

    // Group by endpoint
    const endpointStats: Record<string, EndpointStat> = {};
    recentMetrics.forEach((metric) => {
      const key = `${metric.method} ${metric.endpoint}`;
      if (!endpointStats[key]) {
        endpointStats[key] = {
          count: 0,
          totalTime: 0,
          errors: 0,
          slowRequests: 0,
        };
      }
      endpointStats[key].count++;
      endpointStats[key].totalTime += metric.responseTime;
      if (metric.statusCode >= 400) endpointStats[key].errors++;
      if (metric.responseTime > this.slowRequestThreshold)
        endpointStats[key].slowRequests++;
    });

    Object.keys(endpointStats).forEach((key) => {
      const stat = endpointStats[key]!;
      stat.averageTime = Math.round(stat.totalTime / stat.count);
      stat.errorRate = Math.round((stat.errors / stat.count) * 100);
    });

    return {
      totalRequests,
      averageResponseTime,
      slowRequests,
      slowRequestPercentage: Math.round(
        (slowRequests / totalRequests) * 100
      ),
      errorRate: Math.round((errorRequests / totalRequests) * 100),
      endpointStats,
    };
  }

  // ✅ System health only calculated when requested (not per request)
  getSystemHealth() {
    const memoryUsage = process.memoryUsage();

    return {
      memory: {
        heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
        rss: Math.round(memoryUsage.rss / 1024 / 1024),
      },
      uptime: Math.round(process.uptime()),
      nodeVersion: process.version,
    };
  }

  clearMetrics() {
    this.metrics = [];
  }
}

export const performanceMonitor = new PerformanceMonitor();

// ============ HEALTH CHECK ============
export const healthCheck = async (_req: Request, res: Response) => {
  const systemHealth = performanceMonitor.getSystemHealth();

  // ✅ Minimal info 
  let dbStatus = "unknown";
  try {
    dbStatus =
      mongoose.connection.readyState === 1
        ? "connected"
        : "disconnected";
  } catch {
    dbStatus = "error";
  }

  const status =
    dbStatus === "connected" && systemHealth.memory.heapUsed < 500
      ? "healthy"
      : "degraded";

  res.status(status === "healthy" ? 200 : 503).json({
    status,
    timestamp: new Date().toISOString(),
    uptime: systemHealth.uptime,
    database: dbStatus,
    // ✅ No DB name, no detailed metrics in health check
  });
};

// ============ PERFORMANCE DASHBOARD (protected) ============
export const performanceDashboard = (_req: Request, res: Response) => {
  const stats = performanceMonitor.getStats();
  const systemHealth = performanceMonitor.getSystemHealth();

  res.json({
    performance: stats,
    system: systemHealth,
    timestamp: new Date().toISOString(),
  });
};

// ============ BOT DETECTOR ============
export const apiUsageTracker = (
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  const userAgent = req.get("User-Agent") || "unknown";
  const isBot = /bot|crawl|spider|scraper/i.test(userAgent);

  if (isBot) {
    logger.info(`Bot detected: ${userAgent} → ${req.path}`);
  }

  next();
};