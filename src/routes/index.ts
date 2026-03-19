import express, { Router } from "express";
import { AuthRoutes } from "../module/auth/auth.route";
import { LogsRoutes } from "../module/logs/logs.route";

const router: Router = express.Router();

const apiRoutes = [
  {
    path: "/auth",
    route: AuthRoutes,
  },
  {
    path: "/logs",
    route: LogsRoutes,
  },
];

apiRoutes.forEach((route) => router.use(route.path, route.route));

export default router;
