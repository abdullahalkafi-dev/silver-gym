import { Router } from "express";

import authStaff from "@middlewares/authStaff";
import requirePermission from "@middlewares/requirePermission";
import { TransactionController } from "./transaction.controller";

const router = Router();

/**
 * @route   GET /api/v1/transactions/:branchId/balance
 * @desc    Get transactions grouped by day with opening/closing balances
 * @access  Private (Owner or Staff with canViewTransactions)
 */
router.get(
  "/:branchId/balance",
  authStaff({ allowOwner: true }),
  requirePermission("canViewTransactions"),
  TransactionController.getTransactionsWithBalance,
);

/**
 * @route   GET /api/v1/transactions/:branchId
 * @desc    Get merged income + expense transactions for a branch
 * @access  Private (Owner or Staff with canViewTransactions)
 */
router.get(
  "/:branchId",
  authStaff({ allowOwner: true }),
  requirePermission("canViewTransactions"),
  TransactionController.getTransactions,
);

export const TransactionRoutes = router;
