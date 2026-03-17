import express, { Router } from "express";
import { AuthRoutes } from "../module/auth/auth.route";

const router: Router = express.Router();

const apiRoutes = [
  {
    path: "/auth",
    route: AuthRoutes,
  },
];

apiRoutes.forEach((route) => router.use(route.path, route.route));

export default router;
