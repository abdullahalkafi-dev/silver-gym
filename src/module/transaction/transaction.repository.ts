import { Types } from "mongoose";

import { BD_OFFSET_MS, getDhakaDateString } from "../../utils/dhakaTime";
import { Branch } from "../branch/branch.model";
import { Expense } from "../expense/expense.model";
import { PaymentStatus } from "../payment/payment.interface";
import { Payment } from "../payment/payment.model";

const monthShort = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const formatBDDateTime = (date: Date): string => {
  const bdDate = new Date(date.getTime() + BD_OFFSET_MS);
  const day = String(bdDate.getUTCDate()).padStart(2, "0");
  const month = monthShort[bdDate.getUTCMonth()] ?? "";
  const year = bdDate.getUTCFullYear();
  let hours = bdDate.getUTCHours();
  const minutes = String(bdDate.getUTCMinutes()).padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  return `${day} ${month} ${year}, ${hours}:${minutes} ${ampm}`;
};

const PAYMENT_TYPE_LABELS: Record<string, string> = {
  package: "Package",
  monthly: "Monthly",
  admission: "Admission",
  registration: "Registration",
  locker: "Locker",
  other: "Other",
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: "Cash",
  card: "Card",
  bkash: "Bkash",
  nagad: "Nagad",
  rocket: "Rocket",
  bank_transfer: "Bank",
  other: "Other",
};

const validIncomeStatuses = [
  PaymentStatus.PAID,
  PaymentStatus.PARTIAL,
  PaymentStatus.DUE,
];

const toBranchObjectId = (branchId: string) => new Types.ObjectId(branchId);

export const TransactionRepository = {
  async getTransactions(
    branchId: string,
    filters: {
      searchTerm?: string;
      startDate?: string;
      endDate?: string;
      type?: string;
      paymentMethod?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const branchObjectId = toBranchObjectId(branchId);
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(100, Math.max(1, filters.limit ?? 20));
    const skip = (page - 1) * limit;

    const dateFilter: Record<string, unknown> = {};
    if (filters.startDate) {
      dateFilter.$gte = new Date(filters.startDate);
    }
    if (filters.endDate) {
      dateFilter.$lte = new Date(filters.endDate + "T23:59:59.999Z");
    }

    const paymentMethodFilter = filters.paymentMethod
      ? { paymentMethod: filters.paymentMethod }
      : {};

    const searchFilter: Record<string, unknown>[] = [];
    if (filters.searchTerm) {
      const escaped = filters.searchTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(escaped, "i");
      searchFilter.push(
        { invoiceNo: regex },
        { memberName: regex },
        { description: regex },
        { categoryTitle: regex },
      );
    }

    const shouldQueryIncome = !filters.type || filters.type === "income";
    const shouldQueryExpense = !filters.type || filters.type === "expense";

    const incomeQuery: Record<string, unknown> = {
      branchId: branchObjectId,
      status: { $in: validIncomeStatuses },
      "metadata.entryKind": { $ne: "opening_import_balance" },
      ...paymentMethodFilter,
    };
    if (Object.keys(dateFilter).length > 0) {
      incomeQuery.paymentDate = dateFilter;
    }
    if (searchFilter.length > 0) {
      incomeQuery.$or = searchFilter;
    }

    const expenseQuery: Record<string, unknown> = {
      branchId: branchObjectId,
      isActive: true,
      ...paymentMethodFilter,
    };
    if (Object.keys(dateFilter).length > 0) {
      expenseQuery.expenseDate = dateFilter;
    }
    if (searchFilter.length > 0) {
      expenseQuery.$or = searchFilter.map((f) => {
        const key = Object.keys(f)[0];
        if (key === "memberName" || key === "description") {
          return { categoryTitle: f[key] };
        }
        return f;
      });
    }

    // When a single type is filtered, use DB-level pagination (efficient).
    // When both types are queried, fetch all and paginate in JS (correct).
    const useDbPagination = !!filters.type;

    const incomePipeline: any[] = [
      { $match: incomeQuery },
      { $sort: { paymentDate: -1, createdAt: -1 } },
      {
        $project: {
          invoiceNo: 1,
          paymentDate: 1,
          createdAt: 1,
          memberId: 1,
          memberName: 1,
          paymentType: 1,
          paymentMethod: 1,
          billAmount: 1,
          paidTotal: 1,
          metadata: 1,
        },
      },
    ];

    if (useDbPagination && shouldQueryIncome) {
      incomePipeline.splice(2, 0, { $skip: skip }, { $limit: limit });
    }

    const [incomeResults, expenseResults, incomeCount, expenseCount] = await Promise.all([
      shouldQueryIncome
        ? Payment.aggregate(incomePipeline)
        : Promise.resolve([]),
      shouldQueryExpense
        ? (() => {
            let q = Expense.find(expenseQuery)
              .select("invoiceNo expenseDate createdAt categoryTitle description paymentMethod amount")
              .sort({ expenseDate: -1, createdAt: -1 });
            if (useDbPagination) {
              q = q.skip(skip).limit(limit);
            }
            return q.lean();
          })()
        : Promise.resolve([]),
      shouldQueryIncome
        ? Payment.countDocuments(incomeQuery)
        : Promise.resolve(0),
      shouldQueryExpense
        ? Expense.countDocuments(expenseQuery)
        : Promise.resolve(0),
    ]);

    const merged: Array<{
      dateValue: Date;
      id: string;
      invoiceNo: string;
      type: "income" | "expense";
      category: string;
      description: string;
      memberId: string | null;
      memberCustomId: string | null;
      paymentMethod: string;
      amount: number;
    }> = [];

    (incomeResults as unknown as Array<Record<string, unknown>>).forEach((row) => {
      const rawDate = row.paymentDate || row.createdAt;
      const dateValue = rawDate ? new Date(String(rawDate)) : new Date();
      const id = String(row._id);
      const paymentType = String(row.paymentType || "");
      const memberName = String(row.memberName || "");
      const metadata = row.metadata as Record<string, unknown> | undefined;
      const lockerNumber = metadata?.lockerNumber;

      let description = memberName || paymentType || "Payment";
      if (paymentType === "locker" && lockerNumber) {
        description = `Locker #${lockerNumber}${memberName ? ` - ${memberName}` : ""}`;
      }

      merged.push({
        dateValue,
        id,
        invoiceNo: String(row.invoiceNo),
        type: "income",
        category:
          PAYMENT_TYPE_LABELS[paymentType] || paymentType || "Other",
        description,
        memberId: row.memberId ? String(row.memberId) : null,
        memberCustomId: null,
        paymentMethod:
          PAYMENT_METHOD_LABELS[String(row.paymentMethod || "")] ||
          String(row.paymentMethod || "Other"),
        amount: Number(row.billAmount || row.paidTotal || 0),
      });
    });

    (expenseResults as unknown as Array<Record<string, unknown>>).forEach((row) => {
      const rawDate = row.expenseDate || row.createdAt;
      const dateValue = rawDate ? new Date(String(rawDate)) : new Date();
      const id = String(row._id);

      merged.push({
        dateValue,
        id,
        invoiceNo: String(row.invoiceNo),
        type: "expense",
        category: String(row.categoryTitle || "Expense"),
        description: String(row.description || row.categoryTitle || "Expense"),
        memberId: null,
        memberCustomId: null,
        paymentMethod:
          PAYMENT_METHOD_LABELS[String(row.paymentMethod || "")] ||
          String(row.paymentMethod || "Other"),
        amount: Number(row.amount || 0),
      });
    });

    merged.sort((a, b) => b.dateValue.getTime() - a.dateValue.getTime());

    const total = incomeCount + expenseCount;
    const totalPage = Math.max(1, Math.ceil(total / limit));
    const paginated = merged.slice(skip, skip + limit);

    const data = paginated.map((item) => ({
      id: item.id,
      invoiceNo: item.invoiceNo,
      date: formatBDDateTime(item.dateValue),
      dateISO: item.dateValue.toISOString(),
      type: item.type,
      category: item.category,
      description: item.description,
      memberId: item.memberId,
      memberCustomId: item.memberCustomId,
      paymentMethod: item.paymentMethod,
      amount: item.amount,
    }));

    return {
      data,
      meta: { page, limit, total, totalPage },
    };
  },

  async getTransactionsWithBalance(
    branchId: string,
    filters: {
      startDate?: string;
      endDate?: string;
      type?: string;
      paymentMethod?: string;
    },
  ) {
    const branchObjectId = toBranchObjectId(branchId);

    // 1. Get branch starting balance
    const branch = await Branch.findById(branchObjectId).select("startingBalance").lean();
    const startingBalance = branch?.startingBalance ?? 0;

    // 2. Build date filter for the requested range
    const dateFilter: Record<string, unknown> = {};
    if (filters.startDate) {
      dateFilter.$gte = new Date(filters.startDate);
    }
    if (filters.endDate) {
      dateFilter.$lte = new Date(filters.endDate + "T23:59:59.999Z");
    }

    const paymentMethodFilter = filters.paymentMethod
      ? { paymentMethod: filters.paymentMethod }
      : {};

    const shouldQueryIncome = !filters.type || filters.type === "income";
    const shouldQueryExpense = !filters.type || filters.type === "expense";

    // 3. Calculate opening balance: sum of all transactions BEFORE startDate
    let openingBalanceBeforeRange = startingBalance;

    if (filters.startDate) {
      const beforeDateFilter = { $lt: new Date(filters.startDate) };

      const [incomeBefore, expenseBefore] = await Promise.all([
        shouldQueryIncome
          ? Payment.aggregate([
              {
                $match: {
                  branchId: branchObjectId,
                  status: { $in: validIncomeStatuses },
                  "metadata.entryKind": { $ne: "opening_import_balance" },
                  paymentDate: beforeDateFilter,
                  ...paymentMethodFilter,
                },
              },
              { $group: { _id: null, total: { $sum: "$billAmount" } } },
            ])
          : Promise.resolve([{ total: 0 }]),
        shouldQueryExpense
          ? Expense.aggregate([
              {
                $match: {
                  branchId: branchObjectId,
                  isActive: true,
                  expenseDate: beforeDateFilter,
                  ...paymentMethodFilter,
                },
              },
              { $group: { _id: null, total: { $sum: "$amount" } } },
            ])
          : Promise.resolve([{ total: 0 }]),
      ]);

      const totalIncomeBefore = incomeBefore[0]?.total ?? 0;
      const totalExpenseBefore = expenseBefore[0]?.total ?? 0;
      openingBalanceBeforeRange = startingBalance + totalIncomeBefore - totalExpenseBefore;
    }

    // 4. Fetch all transactions within the date range (no pagination)
    const incomeQuery: Record<string, unknown> = {
      branchId: branchObjectId,
      status: { $in: validIncomeStatuses },
      "metadata.entryKind": { $ne: "opening_import_balance" },
      ...paymentMethodFilter,
    };
    if (Object.keys(dateFilter).length > 0) {
      incomeQuery.paymentDate = dateFilter;
    }

    const expenseQuery: Record<string, unknown> = {
      branchId: branchObjectId,
      isActive: true,
      ...paymentMethodFilter,
    };
    if (Object.keys(dateFilter).length > 0) {
      expenseQuery.expenseDate = dateFilter;
    }

    const [incomeResults, expenseResults] = await Promise.all([
      shouldQueryIncome
        ? Payment.aggregate([
            { $match: incomeQuery },
            {
              $project: {
                invoiceNo: 1,
                paymentDate: 1,
                createdAt: 1,
                memberId: 1,
                memberName: 1,
                paymentType: 1,
                paymentMethod: 1,
                billAmount: 1,
                paidTotal: 1,
                metadata: 1,
              },
            },
            { $sort: { paymentDate: 1, createdAt: 1 } },
          ])
        : Promise.resolve([]),
      shouldQueryExpense
        ? Expense.find(expenseQuery)
            .select("invoiceNo expenseDate createdAt categoryTitle description paymentMethod amount")
            .sort({ expenseDate: 1, createdAt: 1 })
            .lean()
        : Promise.resolve([]),
    ]);

    // 5. Merge and sort by date ASC for running balance calculation
    const merged: Array<{
      dateValue: Date;
      id: string;
      invoiceNo: string;
      type: "income" | "expense";
      category: string;
      description: string;
      memberId: string | null;
      memberCustomId: string | null;
      paymentMethod: string;
      amount: number;
    }> = [];

    (incomeResults as unknown as Array<Record<string, unknown>>).forEach((row) => {
      const rawDate = row.paymentDate || row.createdAt;
      const dateValue = rawDate ? new Date(String(rawDate)) : new Date();
      const id = String(row._id);
      const paymentType = String(row.paymentType || "");
      const memberName = String(row.memberName || "");
      const metadata = row.metadata as Record<string, unknown> | undefined;
      const lockerNumber = metadata?.lockerNumber;

      let description = memberName || paymentType || "Payment";
      if (paymentType === "locker" && lockerNumber) {
        description = `Locker #${lockerNumber}${memberName ? ` - ${memberName}` : ""}`;
      }

      merged.push({
        dateValue,
        id,
        invoiceNo: String(row.invoiceNo),
        type: "income",
        category:
          PAYMENT_TYPE_LABELS[paymentType] || paymentType || "Other",
        description,
        memberId: row.memberId ? String(row.memberId) : null,
        memberCustomId: null,
        paymentMethod:
          PAYMENT_METHOD_LABELS[String(row.paymentMethod || "")] ||
          String(row.paymentMethod || "Other"),
        amount: Number(row.billAmount || row.paidTotal || 0),
      });
    });

    (expenseResults as unknown as Array<Record<string, unknown>>).forEach((row) => {
      const rawDate = row.expenseDate || row.createdAt;
      const dateValue = rawDate ? new Date(String(rawDate)) : new Date();
      const id = String(row._id);

      merged.push({
        dateValue,
        id,
        invoiceNo: String(row.invoiceNo),
        type: "expense",
        category: String(row.categoryTitle || "Expense"),
        description: String(row.description || row.categoryTitle || "Expense"),
        memberId: null,
        memberCustomId: null,
        paymentMethod:
          PAYMENT_METHOD_LABELS[String(row.paymentMethod || "")] ||
          String(row.paymentMethod || "Other"),
        amount: Number(row.amount || 0),
      });
    });

    // Sort ASC by date for running balance calculation
    merged.sort((a, b) => a.dateValue.getTime() - b.dateValue.getTime());

    // 6. Calculate running balance and group by date
    let runningBalance = openingBalanceBeforeRange;

    const dayGroups: Map<
      string,
      {
        dateISO: string;
        transactions: Array<{
          id: string;
          invoiceNo: string;
          date: string;
          dateISO: string;
          type: "income" | "expense";
          category: string;
          description: string;
          memberId: string | null;
          memberCustomId: string | null;
          paymentMethod: string;
          amount: number;
          runningBalance: number;
        }>;
        openingBalance: number;
        closingBalance: number;
      }
    > = new Map();

    for (const item of merged) {
      const dayKey = getDhakaDateString(item.dateValue);

      if (!dayGroups.has(dayKey)) {
        dayGroups.set(dayKey, {
          dateISO: item.dateValue.toISOString(),
          transactions: [],
          openingBalance: runningBalance,
          closingBalance: runningBalance,
        });
      }

      // Update running balance
      if (item.type === "income") {
        runningBalance += item.amount;
      } else {
        runningBalance -= item.amount;
      }

      const group = dayGroups.get(dayKey)!;
      group.transactions.push({
        id: item.id,
        invoiceNo: item.invoiceNo,
        date: formatBDDateTime(item.dateValue),
        dateISO: item.dateValue.toISOString(),
        type: item.type,
        category: item.category,
        description: item.description,
        memberId: item.memberId,
        memberCustomId: item.memberCustomId,
        paymentMethod: item.paymentMethod,
        amount: item.amount,
        runningBalance: Number(runningBalance.toFixed(2)),
      });
      group.closingBalance = Number(runningBalance.toFixed(2));
    }

    // 7. Convert to array and format response
    const todayKey = getDhakaDateString(new Date());

    const data = Array.from(dayGroups.entries()).map(([dayKey, group]) => ({
      date: formatBDDateTime(new Date(group.dateISO)),
      dateISO: group.dateISO,
      openingBalance: Number(group.openingBalance.toFixed(2)),
      closingBalance: Number(group.closingBalance.toFixed(2)),
      isToday: dayKey === todayKey,
      transactions: group.transactions,
    }));

    return {
      data,
      openingBalance: Number(openingBalanceBeforeRange.toFixed(2)),
      closingBalance: Number(runningBalance.toFixed(2)),
    };
  },
};
