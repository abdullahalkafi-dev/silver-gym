import {
  TExpense,
  TExpenseCategory,
  TExpenseHistory,
  TExpenseSubcategory,
} from "./expense.interface";
import {
  Expense,
  ExpenseCategory,
  ExpenseHistory,
  ExpenseSubcategory,
} from "./expense.model";

type QueryOptions = {
  select?: Record<string, 0 | 1> | string;
  sort?: Record<string, 1 | -1> | string;
  limit?: number;
  skip?: number;
  populate?: string | string[];
};

// ─── Category Repository ──────────────────────────────────────────────────────

export const ExpenseCategoryRepository = {
  create(payload: TExpenseCategory) {
    return ExpenseCategory.create(payload);
  },

  findById(id: string) {
    return ExpenseCategory.findById(id);
  },

  findByBranch(branchId: string) {
    return ExpenseCategory.find({ branchId, isActive: true }).sort({
      createdAt: 1,
    });
  },

  updateById(id: string, payload: object) {
    return ExpenseCategory.findByIdAndUpdate(id, payload, {
      returnDocument: "after",
      runValidators: true,
    });
  },

  async softDeleteById(id: string) {
    return ExpenseCategory.findByIdAndUpdate(
      id,
      { isActive: false },
      { returnDocument: "after" },
    );
  },
};

// ─── Subcategory Repository ───────────────────────────────────────────────────

export const ExpenseSubcategoryRepository = {
  create(payload: TExpenseSubcategory) {
    return ExpenseSubcategory.create(payload);
  },

  findById(id: string) {
    return ExpenseSubcategory.findById(id);
  },

  findByCategory(categoryId: string) {
    return ExpenseSubcategory.find({
      categoryId,
      isActive: true,
    }).sort({ createdAt: 1 });
  },

  findByBranch(branchId: string) {
    return ExpenseSubcategory.find({ branchId, isActive: true }).sort({
      createdAt: 1,
    });
  },

  updateById(id: string, payload: object) {
    return ExpenseSubcategory.findByIdAndUpdate(id, payload, {
      returnDocument: "after",
      runValidators: true,
    });
  },

  softDeleteById(id: string) {
    return ExpenseSubcategory.findByIdAndUpdate(
      id,
      { isActive: false },
      { returnDocument: "after" },
    );
  },

  async existsActiveForCategory(categoryId: string) {
    const doc = await ExpenseSubcategory.exists({ categoryId, isActive: true });
    return Boolean(doc);
  },
};

// ─── Expense Repository ───────────────────────────────────────────────────────

export const ExpenseRepository = {
  create(payload: TExpense) {
    return Expense.create(payload);
  },

  findById(id: string) {
    return Expense.findById(id);
  },

  findMany(filter: object = {}, options: QueryOptions = {}) {
    let query = Expense.find(filter);

    if (options.select) {
      query = query.select(options.select);
    }

    if (options.sort) {
      query = query.sort(options.sort);
    }

    if (typeof options.skip === "number") {
      query = query.skip(options.skip);
    }

    if (typeof options.limit === "number") {
      query = query.limit(options.limit);
    }

    if (options.populate) {
      if (Array.isArray(options.populate)) {
        options.populate.forEach((path) => {
          query = query.populate(path);
        });
      } else {
        query = query.populate(options.populate);
      }
    }

    return query;
  },

  countDocuments(filter: object = {}) {
    return Expense.countDocuments(filter);
  },

  updateById(id: string, payload: object) {
    return Expense.findByIdAndUpdate(id, payload, {
      returnDocument: "after",
      runValidators: true,
    });
  },

  softDeleteById(id: string) {
    return Expense.findByIdAndUpdate(
      id,
      { isActive: false },
      { returnDocument: "after" },
    );
  },

  async existsActiveForSubcategory(subcategoryId: string) {
    const doc = await Expense.exists({ subcategoryId, isActive: true });
    return Boolean(doc);
  },

  aggregate(pipeline: object[]) {
    return Expense.aggregate(pipeline);
  },
};

// ─── History Repository ───────────────────────────────────────────────────────

export const ExpenseHistoryRepository = {
  create(payload: TExpenseHistory) {
    return ExpenseHistory.create(payload);
  },

  findByExpenseId(expenseId: string) {
    return ExpenseHistory.find({ expenseId }).sort({ changedAt: -1 });
  },
};
