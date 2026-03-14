import cors from "cors";
import express, { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import router from "./routes";
import cookieParser from "cookie-parser";
import {
  helmetConfig,
  generalLimiter,
  compressionConfig,
  additionalSanitization,
} from "./middlewares/security";
import {
  performanceMonitor,
  healthCheck,
  performanceDashboard,
  apiUsageTracker,
} from "./middlewares/performanceMonitor";
import config from "./config";
import { Morgan } from "./logger/morgan";
import globalErrorHandler from "./middlewares/globalErrorHandler";
const app: express.Application = express();

// ============ 1. TRUST PROXY ============
app.set("trust proxy", 1);

// ============ 2. SECURITY  ============
app.use(helmetConfig);

// ============ 3. CORS (before body parsing!) ============
const allowedOrigins =
  config.node_env === "production"
    ? ["https://domain.com"]
    : [
        "http://localhost:3000",
        "http://localhost:3001",
        "http://10.10.12.125:3000",
      ];

app.use(
  cors({
    origin: allowedOrigins,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    credentials: true,
    maxAge: 86400,
  }),
);

// ============ 4. COMPRESSION ============
app.use(compressionConfig);

// ============ 5. RATE LIMITING ============
app.use(generalLimiter);

// ============ 6. BODY PARSERS ============
app.use(
  express.json({
    limit: "5mb",
    verify: (req: any, _res, buf, encoding) => {
      if (req.originalUrl?.includes("/webhook")) {
        req.rawBody = buf.toString((encoding as BufferEncoding) || "utf8");
      }
    },
  }),
);

app.use(express.urlencoded({ extended: true, limit: "5mb" }));
app.use(cookieParser());

// ============ 7. SANITIZATION ============
app.use(additionalSanitization);

// ============ 8. PERFORMANCE MONITORING ============
app.use(performanceMonitor.requestMonitor());
app.use(apiUsageTracker);

// ============ 9. STATIC FILES (with prefix) ============
app.use(
  "/uploads",
  express.static("uploads", {
    maxAge: "1d", // ✅ Browser caching
    etag: true,
    dotfiles: "deny", // ✅ Block .env, .git etc.
  }),
);

// ============ 10. HEALTH CHECK (no auth needed) ============
app.get("/health", healthCheck);

// ============ 11. ROOT ROUTE ============
app.get("/", (_req: Request, res: Response) => {
  res.status(StatusCodes.OK).json({
    success: true,
    message: "Server is running",
  });
});

// ============ 12. MORGAN + ROUTES ============
app.use(Morgan.successHandler);
app.use(Morgan.errorHandler);

// ✅ Performance dashboard (protected)
app.get(
  "/api/v1/performance",
  (req: Request, res: Response, next) => {
    const adminKey = req.headers["x-admin-key"];
    if (adminKey !== config.admin_secret_key) {
      return res.status(StatusCodes.UNAUTHORIZED).json({
        success: false,
        message: "Unauthorized",
      });
    }
    next();
  },
  performanceDashboard,
);

// API routes
app.use("/api/v1", router);

// ============ 13. ERROR HANDLING ============
app.use(globalErrorHandler);

//live response
app.get("/", (_req: Request, res: Response) => {
  res.send(
    ` <div style="display: flex; align-items: center; justify-content: center; height: 100vh; background: #f5f3ff; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
    <div style="text-align: center; padding: 2rem 3rem; background-color: #ffffff; border-radius: 16px; box-shadow: 0 10px 25px rgba(0, 0, 0, 0.08);">
      <h1 style="font-size: 2.5rem; color: #7C3AED; margin-bottom: 1rem;">Welcome 👋</h1>
      <p style="font-size: 1.2rem; color: #555;">I'm here to help you. How can I assist today?</p>
      <div style="margin-top: 2rem;">
        <p style="color: #777;">Want to see more projects or contact me?</p>
        <a href="https://github.com/abdullahalkafi-dev" target="_blank" style="text-decoration: none; color: #fff; background-color: #6D28D9; padding: 0.75rem 1.5rem; border-radius: 8px; font-weight: bold; display: inline-block; transition: background 0.3s;">
          Visit My GitHub 🚀
        </a>
      </div>
    </div>
  </div>`,
  );
});

// ============ 14. 404 (must be last) ============
app.use((req: Request, res: Response) => {
  res.status(StatusCodes.NOT_FOUND).json({
    success: false,
    message: "Not found",
    errorMessages: [
      {
        path: req.originalUrl,
        message: "API doesn't exist",
      },
    ],
  });
});

export default app;
