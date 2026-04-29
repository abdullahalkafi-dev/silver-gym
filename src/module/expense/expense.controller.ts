import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { Types } from "mongoose";

import AppError from "../../errors/AppError";
import catchAsync from "../../shared/catchAsync";
import sendResponse from "../../shared/sendResponse";
import { ExpenseService } from "./expense.service";

const resolveActor = (req: Request) => {
  if (req.user?._id) {
    return {
      userId: new Types.ObjectId(req.user._id),
    };
  }

  if (req.staff) {
    return {
      staff: req.staff,
    };
  }

  throw new AppError(StatusCodes.UNAUTHORIZED, "You are not authorized");
};

// ─── Category Handlers ────────────────────────────────────────────────────────

const createCategory = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;
  const payload = req.body.data || req.body;

  const result = await ExpenseService.createCategory(
    branchId,
    resolveActor(req),
    payload,
  );

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: "Expense category created successfully",
    data: result,
  });
});

const getCategories = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;

  const result = await ExpenseService.getCategories(branchId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Expense categories retrieved successfully",
    data: result,
  });
});

const updateCategory = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;
  const categoryId = req.params.categoryId as string;
  const payload = req.body.data || req.body;

  const result = await ExpenseService.updateCategory(
    branchId,
    categoryId,
    resolveActor(req),
    payload,
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Expense category updated successfully",
    data: result,
  });
});

const deleteCategory = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;
  const categoryId = req.params.categoryId as string;

  await ExpenseService.deleteCategory(branchId, categoryId, resolveActor(req));

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Expense category deleted successfully",
    data: null,
  });
});

// ─── Subcategory Handlers ─────────────────────────────────────────────────────

const createSubcategory = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;
  const categoryId = req.params.categoryId as string;
  const payload = req.body.data || req.body;

  const result = await ExpenseService.createSubcategory(
    branchId,
    categoryId,
    resolveActor(req),
    payload,
  );

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: "Expense subcategory created successfully",
    data: result,
  });
});

const updateSubcategory = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;
  const subcategoryId = req.params.subcategoryId as string;
  const payload = req.body.data || req.body;

  const result = await ExpenseService.updateSubcategory(
    branchId,
    subcategoryId,
    resolveActor(req),
    payload,
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Expense subcategory updated successfully",
    data: result,
  });
});

const deleteSubcategory = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;
  const subcategoryId = req.params.subcategoryId as string;

  await ExpenseService.deleteSubcategory(
    branchId,
    subcategoryId,
    resolveActor(req),
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Expense subcategory deleted successfully",
    data: null,
  });
});

// ─── Expense Handlers ─────────────────────────────────────────────────────────

const createExpense = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;
  const payload = req.body.data || req.body;

  const result = await ExpenseService.createExpense(
    branchId,
    resolveActor(req),
    payload,
  );

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: "Expense created successfully",
    data: result,
  });
});

const getExpenses = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;

  const result = await ExpenseService.getExpenses(
    branchId,
    resolveActor(req),
    req.query as Record<string, unknown>,
  );

  res.status(StatusCodes.OK).json({
    success: true,
    message: "Expenses retrieved successfully",
    meta: result.meta,
    data: result.result,
    totalAmount: result.totalAmount, // Add totalAmount to response here
  });
});

const getExpenseById = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;
  const expenseId = req.params.expenseId as string;

  const result = await ExpenseService.getExpenseById(
    branchId,
    expenseId,
    resolveActor(req),
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Expense retrieved successfully",
    data: result,
  });
});

const updateExpense = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;
  const expenseId = req.params.expenseId as string;
  const payload = req.body.data || req.body;

  const result = await ExpenseService.updateExpense(
    branchId,
    expenseId,
    resolveActor(req),
    payload,
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Expense updated successfully",
    data: result,
  });
});

const deleteExpense = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;
  const expenseId = req.params.expenseId as string;

  await ExpenseService.deleteExpense(branchId, expenseId, resolveActor(req));

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Expense deleted successfully",
    data: null,
  });
});

const getExpenseHistory = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;
  const expenseId = req.params.expenseId as string;

  const result = await ExpenseService.getExpenseHistory(
    branchId,
    expenseId,
    resolveActor(req),
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Expense history retrieved successfully",
    data: result,
  });
});

export const ExpenseController = {
  createCategory,
  getCategories,
  updateCategory,
  deleteCategory,
  createSubcategory,
  updateSubcategory,
  deleteSubcategory,
  createExpense,
  getExpenses,
  getExpenseById,
  updateExpense,
  deleteExpense,
  getExpenseHistory,
};
