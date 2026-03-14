import express, { Router } from "express";
import { UserRoutes } from "../module/user/user.route";

const router: Router = express.Router();

const apiRoutes = [
  {
    path: "/users",
    route: UserRoutes,
  },
];

apiRoutes.forEach((route) => router.use(route.path, route.route));

export default router;
