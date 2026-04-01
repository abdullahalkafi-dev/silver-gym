import express, { Router } from "express";
import { AuthRoutes } from "../module/auth/auth.route";
import { LogsRoutes } from "../module/logs/logs.route";
import { BusinessProfileRoutes } from "../module/businessProfile/businessProfile.route";
import { BranchRoutes } from "../module/branch/branch.route";
import { RoleRoute } from "../module/role/role.route";
import { StaffRoutes } from "../module/staff/staff.route";
import { MemberRoutes } from "../module/member/member.route";

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
  {
    path: "/business-profile",
    route: BusinessProfileRoutes,
  },
  {
    path: "/branches",
    route: BranchRoutes,
  },
  {
    path: "/roles",
    route: RoleRoute,
  },
  {
    path: "/staff",
    route: StaffRoutes,
  },
  {
    path: "/members",
    route: MemberRoutes,
  },
];

apiRoutes.forEach((route) => router.use(route.path, route.route));

export default router;
