import express, { Router } from "express";
import { AuthRoutes } from "../module/auth/auth.route";
import { LogsRoutes } from "../module/logs/logs.route";
import { BusinessProfileRoutes } from "../module/businessProfile/businessProfile.route";
import { BranchRoutes } from "../module/branch/branch.route";
import { RoleRoute } from "../module/role/role.route";
import { StaffRoutes } from "../module/staff/staff.route";
import { MemberRoutes } from "../module/member/member.route";
import { UserRoutes } from "../module/user/user.route";
import PackageRoutes from "../module/package/package.route";
import PaymentRoutes from "../module/payment/payment.route";
import { ExpenseRoutes } from "../module/expense/expense.route";
import { AnalyticsRoutes } from "../module/analytics/analytics.route";
import { SmsRoutes } from "../module/sms/sms.route";
import { TransactionRoutes } from "../module/transaction/transaction.route";
import { LockerRoutes } from "../module/locker/locker.route";
import { IncomeCategoryRoutes } from "../module/incomeCategory/incomeCategory.route";

const router: Router = express.Router();

const apiRoutes = [
  {
    path: "/income-categories",
    route: IncomeCategoryRoutes,
  },
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
    path: "/users",
    route: UserRoutes,
  },
  {
    path: "/members",
    route: MemberRoutes,
  },
  {
    path: "/packages",
    route: PackageRoutes,
  },
  {
    path: "/payments",
    route: PaymentRoutes,
  },
  {
    path: "/expenses",
    route: ExpenseRoutes,
  },
  {
    path: "/analytics",
    route: AnalyticsRoutes,
  },
  {
    path: "/sms",
    route: SmsRoutes,
  },
  {
    path: "/transactions",
    route: TransactionRoutes,
  },
  {
    path: "/lockers",
    route: LockerRoutes,
  },
];

apiRoutes.forEach((route) => router.use(route.path, route.route));

export default router;
