import { Router } from "express";

import authStaff from "@middlewares/authStaff";
import requirePermission from "@middlewares/requirePermission";
import { authLimiter } from "@middlewares/security";
import validateRequest from "@middlewares/validateRequest";
import { ExpenseController } from "./expense.controller";
import { ExpenseDto } from "./expense.dto";

const router = Router();

// ─── Category Routes ──────────────────────────────────────────────────────────

/**
 * @route   POST /api/v1/expenses/:branchId/categories
 * @desc    Create a new expense category
 * @access  Private (Owner or Staff with canManageExpenseCategory)
 */
router.post(
  "/:branchId/categories",
  authLimiter,
  authStaff({ allowOwner: true }),
  requirePermission("canManageExpenseCategory"),
  validateRequest(ExpenseDto.createCategory),
  ExpenseController.createCategory,
);

/**
 * @route   GET /api/v1/expenses/:branchId/categories
 * @desc    Get all expense categories with subcategories for a branch
 * @access  Private (Owner or Staff with canViewExpenseCategory)
 */
router.get(
  "/:branchId/categories",
  authStaff({ allowOwner: true }),
  requirePermission("canViewExpenseCategory"),
  ExpenseController.getCategories,
);

/**
 * @route   PATCH /api/v1/expenses/:branchId/categories/:categoryId
 * @desc    Update an expense category
 * @access  Private (Owner or Staff with canManageExpenseCategory)
 */
router.patch(
  "/:branchId/categories/:categoryId",
  authLimiter,
  authStaff({ allowOwner: true }),
  requirePermission("canManageExpenseCategory"),
  validateRequest(ExpenseDto.updateCategory),
  ExpenseController.updateCategory,
);

/**
 * @route   DELETE /api/v1/expenses/:branchId/categories/:categoryId
 * @desc    Delete (soft) an expense category
 * @access  Private (Owner or Staff with canManageExpenseCategory)
 */
router.delete(
  "/:branchId/categories/:categoryId",
  authLimiter,
  authStaff({ allowOwner: true }),
  requirePermission("canManageExpenseCategory"),
  ExpenseController.deleteCategory,
);

// ─── Subcategory Routes ───────────────────────────────────────────────────────

/**
 * @route   POST /api/v1/expenses/:branchId/categories/:categoryId/subcategories
 * @desc    Create a new subcategory under a category
 * @access  Private (Owner or Staff with canManageExpenseCategory)
 */
router.post(
  "/:branchId/categories/:categoryId/subcategories",
  authLimiter,
  authStaff({ allowOwner: true }),
  requirePermission("canManageExpenseCategory"),
  validateRequest(ExpenseDto.createSubcategory),
  ExpenseController.createSubcategory,
);

/**
 * @route   PATCH /api/v1/expenses/:branchId/subcategories/:subcategoryId
 * @desc    Update a subcategory
 * @access  Private (Owner or Staff with canManageExpenseCategory)
 */
router.patch(
  "/:branchId/subcategories/:subcategoryId",
  authLimiter,
  authStaff({ allowOwner: true }),
  requirePermission("canManageExpenseCategory"),
  validateRequest(ExpenseDto.updateSubcategory),
  ExpenseController.updateSubcategory,
);

/**
 * @route   DELETE /api/v1/expenses/:branchId/subcategories/:subcategoryId
 * @desc    Delete (soft) a subcategory
 * @access  Private (Owner or Staff with canManageExpenseCategory)
 */
router.delete(
  "/:branchId/subcategories/:subcategoryId",
  authLimiter,
  authStaff({ allowOwner: true }),
  requirePermission("canManageExpenseCategory"),
  ExpenseController.deleteSubcategory,
);

// ─── Expense Routes ───────────────────────────────────────────────────────────

/**
 * @route   POST /api/v1/expenses/:branchId
 * @desc    Create a new expense record
 * @access  Private (Owner or Staff with canAddExpense)
 */
router.post(
  "/:branchId",
  authLimiter,
  authStaff({ allowOwner: true }),
  requirePermission("canAddExpense"),
  validateRequest(ExpenseDto.createExpense),
  ExpenseController.createExpense,
);

/**
 * @route   GET /api/v1/expenses/:branchId
 * @desc    Get paginated expense list for a branch with filters
 * @access  Private (Owner or Staff with canViewExpense)
 */
router.get(
  "/:branchId",
  authStaff({ allowOwner: true }),
  requirePermission("canViewExpense"),
  ExpenseController.getExpenses,
);

/**
 * @route   GET /api/v1/expenses/:branchId/:expenseId/history
 * @desc    Get version history for a specific expense
 * @access  Private (Owner or Staff with canViewExpense)
 */
router.get(
  "/:branchId/:expenseId/history",
  authStaff({ allowOwner: true }),
  requirePermission("canViewExpense"),
  ExpenseController.getExpenseHistory,
);

/**
 * @route   GET /api/v1/expenses/:branchId/:expenseId
 * @desc    Get a single expense by ID
 * @access  Private (Owner or Staff with canViewExpense)
 */
router.get(
  "/:branchId/:expenseId",
  authStaff({ allowOwner: true }),
  requirePermission("canViewExpense"),
  ExpenseController.getExpenseById,
);

/**
 * @route   PATCH /api/v1/expenses/:branchId/:expenseId
 * @desc    Update an expense (creates history snapshot before update)
 * @access  Private (Owner or Staff with canAddExpense)
 */
router.patch(
  "/:branchId/:expenseId",
  authLimiter,
  authStaff({ allowOwner: true }),
  requirePermission("canAddExpense"),
  validateRequest(ExpenseDto.updateExpense),
  ExpenseController.updateExpense,
);

/**
 * @route   DELETE /api/v1/expenses/:branchId/:expenseId
 * @desc    Soft-delete an expense (creates history snapshot before delete)
 * @access  Private (Owner or Staff with canAddExpense)
 */
router.delete(
  "/:branchId/:expenseId",
  authLimiter,
  authStaff({ allowOwner: true }),
  requirePermission("canAddExpense"),
  ExpenseController.deleteExpense,
);

export const ExpenseRoutes = router;
