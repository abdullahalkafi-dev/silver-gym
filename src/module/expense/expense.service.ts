import { StatusCodes } from "http-status-codes";
import { Types } from "mongoose";

import AppError from "../../errors/AppError";
import { BranchRepository } from "../branch/branch.repository";
import { TStaff } from "../staff/staff.interface";
import {
  ExpensePaymentMethod,
  TExpense,
  TExpenseCategory,
  TExpenseSubcategory,
} from "./expense.interface";
import {
  ExpenseCategoryRepository,
  ExpenseHistoryRepository,
  ExpenseRepository,
  ExpenseSubcategoryRepository,
} from "./expense.repository";

type TAccessActor = {
  userId?: Types.ObjectId;
  staff?: TStaff;
};

type TCreateCategoryPayload = {
  title: string;
  description?: string;
  color?: string;
};

type TCreateSubcategoryPayload = {
  title: string;
};

type TCreateExpensePayload = {
  subcategoryId: string;
  description?: string;
  amount: number;
  paymentMethod: ExpensePaymentMethod;
  expenseDate?: Date;
};

type TUpdateExpensePayload = {
  description?: string;
  amount?: number;
  paymentMethod?: ExpensePaymentMethod;
  expenseDate?: Date;
};

type TQueryExpenses = {
  searchTerm?: string;
  subcategoryId?: string;
  categoryId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  paymentMethod?: ExpensePaymentMethod;
  sort?: string;
  page?: number;
  limit?: number;
};

const resolveActorId = (actor: TAccessActor): Types.ObjectId | undefined => {
  if (actor.userId) return actor.userId;
  if (actor.staff?._id) return new Types.ObjectId(String(actor.staff._id));
  return undefined;
};

const generateInvoiceNo = (): string => {
  const timestamp = Date.now().toString().slice(-8);
  const random = Math.floor(1000 + Math.random() * 9000);
  return `EXP-${timestamp}${random}`;
};

// ─── Category Service ─────────────────────────────────────────────────────────

const createCategory = async (
  branchId: string,
  actor: TAccessActor,
  payload: TCreateCategoryPayload,
) => {
  const branch = await BranchRepository.findById(branchId);
  if (!branch) throw new AppError(StatusCodes.NOT_FOUND, "Branch not found");

  const categoryData: TExpenseCategory = {
    branchId: new Types.ObjectId(branchId),
    title: payload.title,
    description: payload.description,
    color: payload.color,
    isActive: true,
  };

  return ExpenseCategoryRepository.create(categoryData);
};

const getCategories = async (branchId: string) => {
  const branch = await BranchRepository.findById(branchId);
  if (!branch) throw new AppError(StatusCodes.NOT_FOUND, "Branch not found");

  const categories = await ExpenseCategoryRepository.findByBranch(branchId);

  const categoriesWithSubs = await Promise.all(
    categories.map(async (cat) => {
      const subcategories = await ExpenseSubcategoryRepository.findByCategory(
        String(cat._id),
      );
      return {
        ...cat.toObject(),
        subcategories,
      };
    }),
  );

  return categoriesWithSubs;
};

const updateCategory = async (
  branchId: string,
  categoryId: string,
  actor: TAccessActor,
  payload: Partial<TCreateCategoryPayload>,
) => {
  const category = await ExpenseCategoryRepository.findById(categoryId);
  if (!category || String(category.branchId) !== branchId || !category.isActive) {
    throw new AppError(StatusCodes.NOT_FOUND, "Expense category not found");
  }

  return ExpenseCategoryRepository.updateById(categoryId, { $set: payload });
};

const deleteCategory = async (
  branchId: string,
  categoryId: string,
  actor: TAccessActor,
) => {
  const category = await ExpenseCategoryRepository.findById(categoryId);
  if (!category || String(category.branchId) !== branchId || !category.isActive) {
    throw new AppError(StatusCodes.NOT_FOUND, "Expense category not found");
  }

  const hasSubcategories =
    await ExpenseSubcategoryRepository.existsActiveForCategory(categoryId);
  if (hasSubcategories) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "Cannot delete category that has active subcategories. Remove all subcategories first.",
    );
  }

  return ExpenseCategoryRepository.softDeleteById(categoryId);
};

// ─── Subcategory Service ──────────────────────────────────────────────────────

const createSubcategory = async (
  branchId: string,
  categoryId: string,
  actor: TAccessActor,
  payload: TCreateSubcategoryPayload,
) => {
  const category = await ExpenseCategoryRepository.findById(categoryId);
  if (!category || String(category.branchId) !== branchId || !category.isActive) {
    throw new AppError(StatusCodes.NOT_FOUND, "Expense category not found");
  }

  const subcategoryData: TExpenseSubcategory = {
    branchId: new Types.ObjectId(branchId),
    categoryId: new Types.ObjectId(categoryId),
    title: payload.title,
    isActive: true,
  };

  return ExpenseSubcategoryRepository.create(subcategoryData);
};

const updateSubcategory = async (
  branchId: string,
  subcategoryId: string,
  actor: TAccessActor,
  payload: Partial<TCreateSubcategoryPayload>,
) => {
  const subcategory =
    await ExpenseSubcategoryRepository.findById(subcategoryId);
  if (
    !subcategory ||
    String(subcategory.branchId) !== branchId ||
    !subcategory.isActive
  ) {
    throw new AppError(StatusCodes.NOT_FOUND, "Expense subcategory not found");
  }

  return ExpenseSubcategoryRepository.updateById(subcategoryId, {
    $set: payload,
  });
};

const deleteSubcategory = async (
  branchId: string,
  subcategoryId: string,
  actor: TAccessActor,
) => {
  const subcategory =
    await ExpenseSubcategoryRepository.findById(subcategoryId);
  if (
    !subcategory ||
    String(subcategory.branchId) !== branchId ||
    !subcategory.isActive
  ) {
    throw new AppError(StatusCodes.NOT_FOUND, "Expense subcategory not found");
  }

  const hasExpenses =
    await ExpenseRepository.existsActiveForSubcategory(subcategoryId);
  if (hasExpenses) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "Cannot delete subcategory that has active expense records.",
    );
  }

  return ExpenseSubcategoryRepository.softDeleteById(subcategoryId);
};

// ─── Expense Service ──────────────────────────────────────────────────────────

const createExpense = async (
  branchId: string,
  actor: TAccessActor,
  payload: TCreateExpensePayload,
) => {
  const branch = await BranchRepository.findById(branchId);
  if (!branch) throw new AppError(StatusCodes.NOT_FOUND, "Branch not found");

  const subcategory = await ExpenseSubcategoryRepository.findById(
    payload.subcategoryId,
  );
  if (
    !subcategory ||
    String(subcategory.branchId) !== branchId ||
    !subcategory.isActive
  ) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "Subcategory not found or does not belong to this branch",
    );
  }

  const category = await ExpenseCategoryRepository.findById(
    String(subcategory.categoryId),
  );

  const expenseData: TExpense = {
    branchId: new Types.ObjectId(branchId),
    subcategoryId: new Types.ObjectId(payload.subcategoryId),
    subcategoryTitle: subcategory.title,
    categoryId: subcategory.categoryId,
    categoryTitle: category?.title,
    invoiceNo: generateInvoiceNo(),
    description: payload.description,
    amount: payload.amount,
    paymentMethod: payload.paymentMethod,
    expenseDate: payload.expenseDate ?? new Date(),
    isActive: true,
    createdBy: resolveActorId(actor),
  };

  return ExpenseRepository.create(expenseData);
};

const getExpenses = async (
  branchId: string,
  actor: TAccessActor,
  query: TQueryExpenses,
) => {
  const filter: Record<string, unknown> = {
    branchId: new Types.ObjectId(branchId),
    isActive: true,
  };

  if (query.subcategoryId) {
    filter.subcategoryId = new Types.ObjectId(query.subcategoryId);
  }

  if (query.categoryId) {
    filter.categoryId = new Types.ObjectId(query.categoryId);
  }

  if (query.paymentMethod) {
    filter.paymentMethod = query.paymentMethod;
  }

  if (query.dateFrom || query.dateTo) {
    const dateFilter: Record<string, Date> = {};
    if (query.dateFrom) dateFilter.$gte = new Date(query.dateFrom);
    if (query.dateTo) dateFilter.$lte = new Date(query.dateTo);
    filter.expenseDate = dateFilter;
  }

  if (query.searchTerm) {
    const escaped = query.searchTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$or = [
      { invoiceNo: new RegExp(escaped, "i") },
      { subcategoryTitle: new RegExp(escaped, "i") },
      { categoryTitle: new RegExp(escaped, "i") },
      { description: new RegExp(escaped, "i") },
    ];
  }

  const page = query.page ?? 1;
  const limit = query.limit ?? 20;
  const skip = (page - 1) * limit;
  const sort = query.sort ?? "-expenseDate";

  const [result, total] = await Promise.all([
    ExpenseRepository.findMany(filter, { sort, skip, limit }),
    ExpenseRepository.countDocuments(filter),
  ]);

  // Aggregate total amount for current filter
  const aggregation = await ExpenseRepository.aggregate([
    { $match: filter },
    { $group: { _id: null, totalAmount: { $sum: "$amount" } } },
  ]);
  const totalAmount: number = aggregation[0]?.totalAmount ?? 0;

  return {
    result,
    meta: {
      page,
      limit,
      total,
      totalPage: Math.ceil(total / limit),
    },
    totalAmount,
  };
};

const getExpenseById = async (
  branchId: string,
  expenseId: string,
  actor: TAccessActor,
) => {
  const expense = await ExpenseRepository.findById(expenseId);
  if (
    !expense ||
    String(expense.branchId) !== branchId ||
    !expense.isActive
  ) {
    throw new AppError(StatusCodes.NOT_FOUND, "Expense not found");
  }

  return expense;
};

const updateExpense = async (
  branchId: string,
  expenseId: string,
  actor: TAccessActor,
  payload: TUpdateExpensePayload,
) => {
  const expense = await ExpenseRepository.findById(expenseId);
  if (
    !expense ||
    String(expense.branchId) !== branchId ||
    !expense.isActive
  ) {
    throw new AppError(StatusCodes.NOT_FOUND, "Expense not found");
  }

  // Save history snapshot BEFORE update
  await ExpenseHistoryRepository.create({
    expenseId: expense._id as Types.ObjectId,
    branchId: new Types.ObjectId(branchId),
    snapshot: expense.toObject(),
    changedBy: resolveActorId(actor),
    changeType: "update",
    changedAt: new Date(),
  });

  return ExpenseRepository.updateById(expenseId, { $set: payload });
};

const deleteExpense = async (
  branchId: string,
  expenseId: string,
  actor: TAccessActor,
) => {
  const expense = await ExpenseRepository.findById(expenseId);
  if (
    !expense ||
    String(expense.branchId) !== branchId ||
    !expense.isActive
  ) {
    throw new AppError(StatusCodes.NOT_FOUND, "Expense not found");
  }

  // Save history snapshot BEFORE delete
  await ExpenseHistoryRepository.create({
    expenseId: expense._id as Types.ObjectId,
    branchId: new Types.ObjectId(branchId),
    snapshot: expense.toObject(),
    changedBy: resolveActorId(actor),
    changeType: "delete",
    changedAt: new Date(),
  });

  return ExpenseRepository.softDeleteById(expenseId);
};

const getExpenseHistory = async (
  branchId: string,
  expenseId: string,
  actor: TAccessActor,
) => {
  const expense = await ExpenseRepository.findById(expenseId);
  if (!expense || String(expense.branchId) !== branchId) {
    throw new AppError(StatusCodes.NOT_FOUND, "Expense not found");
  }

  return ExpenseHistoryRepository.findByExpenseId(expenseId);
};

export const ExpenseService = {
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
