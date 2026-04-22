import { z } from "zod";
import { ExpensePaymentMethod } from "./expense.interface";

const paymentMethodValues = Object.values(ExpensePaymentMethod) as [
  string,
  ...string[],
];

// ─── Category DTOs ────────────────────────────────────────────────────────────

const createCategoryDto = z.object({
  data: z
    .object({
      title: z.string().trim().min(1, "Category title is required"),
      description: z.string().trim().optional(),
      color: z.string().trim().optional(),
    })
    .strict(),
});

const updateCategoryDto = z.object({
  data: z
    .object({
      title: z.string().trim().min(1, "Category title is required").optional(),
      description: z.string().trim().optional(),
      color: z.string().trim().optional(),
    })
    .strict(),
});

// ─── Subcategory DTOs ─────────────────────────────────────────────────────────

const createSubcategoryDto = z.object({
  data: z
    .object({
      title: z.string().trim().min(1, "Subcategory title is required"),
    })
    .strict(),
});

const updateSubcategoryDto = z.object({
  data: z
    .object({
      title: z.string().trim().min(1, "Subcategory title is required").optional(),
    })
    .strict(),
});

// ─── Expense DTOs ─────────────────────────────────────────────────────────────

const createExpenseDto = z.object({
  data: z
    .object({
      subcategoryId: z
        .string()
        .trim()
        .min(1, "Subcategory ID is required"),
      description: z.string().trim().optional(),
      amount: z.number().min(0.01, "Amount must be greater than 0"),
      paymentMethod: z.enum(paymentMethodValues),
      expenseDate: z.coerce.date().optional(),
    })
    .strict(),
});

const updateExpenseDto = z.object({
  data: z
    .object({
      description: z.string().trim().optional(),
      amount: z.number().min(0.01, "Amount must be greater than 0").optional(),
      paymentMethod: z.enum(paymentMethodValues).optional(),
      expenseDate: z.coerce.date().optional(),
    })
    .strict(),
});

const queryExpensesDto = z.object({
  searchTerm: z.string().trim().optional(),
  subcategoryId: z.string().trim().optional(),
  categoryId: z.string().trim().optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  paymentMethod: z.enum(paymentMethodValues).optional(),
  sort: z.string().trim().optional(),
  page: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : 1)),
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : 20)),
});

export const ExpenseDto = {
  createCategory: createCategoryDto,
  updateCategory: updateCategoryDto,
  createSubcategory: createSubcategoryDto,
  updateSubcategory: updateSubcategoryDto,
  createExpense: createExpenseDto,
  updateExpense: updateExpenseDto,
  queryExpenses: queryExpensesDto,
};
