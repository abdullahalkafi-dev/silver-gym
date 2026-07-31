import { Router } from "express";
import authStaff from "@middlewares/authStaff";
import requirePermission from "@middlewares/requirePermission";
import { authLimiter } from "@middlewares/security";
import { IncomeCategoryController } from "./incomeCategory.controller";

const router = Router();

router.post(
  "/:branchId",
  authLimiter,
  authStaff({ allowOwner: true }),
  requirePermission("canManagePayments"),
  IncomeCategoryController.createCategory,
);

router.get(
  "/:branchId",
  authStaff({ allowOwner: true }),
  IncomeCategoryController.getCategories,
);

router.patch(
  "/:branchId/:categoryId",
  authLimiter,
  authStaff({ allowOwner: true }),
  requirePermission("canManagePayments"),
  IncomeCategoryController.updateCategory,
);

router.delete(
  "/:branchId/:categoryId",
  authLimiter,
  authStaff({ allowOwner: true }),
  requirePermission("canManagePayments"),
  IncomeCategoryController.deleteCategory,
);

export const IncomeCategoryRoutes = router;
