import { StatusCodes } from "http-status-codes";
import { Types } from "mongoose";

import AppError from "../../errors/AppError";
import { BranchRepository } from "../branch/branch.repository";
import { BusinessProfileRepository } from "../businessProfile/businessProfile.repository";
import {
  TAnalyticsActor,
  TAnalyticsCompareQuery,
  TAnalyticsQuery,
  TCompareChartPoint,
  TCompareTableRow,
  TCostAnalyticsSummary,
  TFinancialAnalyticsPoint,
  TFinancialAnalyticsSummary,
  TMemberAnalyticsPoint,
  TMemberAnalyticsSummary,
  TOverviewSummary,
  TOverviewTransaction,
  TPackagesAnalyticsSummary,
} from "./analytics.interface";
import { AnalyticsRepository } from "./analytics.repository";

type TStaffLike = {
  _id?: Types.ObjectId | string;
  isActive?: boolean;
  branchId?: Types.ObjectId | string;
};

const monthNames = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const monthShort = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const categoryPalette = [
  "#F75270",
  "#BBDCE5",
  "#FFDBB6",
  "#A8BBA3",
  "#0BA6DF",
  "#67C090",
  "#9AC1AE",
  "#E6957F",
  "#64667C",
  "#B7B976",
];

const toYear = (value: unknown, fallback: number) => {
  if (typeof value !== "string") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 2000 || parsed > 2200) return fallback;
  return parsed;
};

const toMonth = (value: unknown) => {
  if (typeof value !== "string" || value.length === 0) return "All Months";
  return value;
};

const toLimit = (value: unknown, fallback: number) => {
  if (typeof value !== "string") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(100, parsed));
};

const percentageChange = (current: number, previous: number) => {
  if (previous === 0) {
    return current > 0 ? 100 : 0;
  }
  return ((current - previous) / Math.abs(previous)) * 100;
};

const resolveBranchAccess = async (branchId: string, actor: TAnalyticsActor) => {
  const branch = await BranchRepository.findOne({
    _id: new Types.ObjectId(branchId),
    isActive: true,
  });

  if (!branch) {
    throw new AppError(StatusCodes.NOT_FOUND, "Branch not found");
  }

  if (actor.userId) {
    const business = await BusinessProfileRepository.findOne({
      _id: branch.businessId,
      userId: actor.userId,
    });

    if (!business) {
      throw new AppError(
        StatusCodes.FORBIDDEN,
        "You do not have permission to access this branch",
      );
    }

    return branch;
  }

  const staff = actor.staff as TStaffLike | undefined;
  if (staff) {
    if (!staff.isActive) {
      throw new AppError(StatusCodes.FORBIDDEN, "Staff account is inactive");
    }

    if (String(staff.branchId) !== String(branch._id)) {
      throw new AppError(
        StatusCodes.FORBIDDEN,
        "You do not have permission to access this branch",
      );
    }

    return branch;
  }

  throw new AppError(StatusCodes.UNAUTHORIZED, "You are not authorized");
};

const getMetricValue = (
  metric: "income" | "expense" | "netIncome",
  income: number,
  expense: number,
) => {
  if (metric === "income") return income;
  if (metric === "expense") return expense;
  return income - expense;
};

const getMemberSummary = async (
  branchId: string,
  actor: TAnalyticsActor,
  query: TAnalyticsQuery,
): Promise<TMemberAnalyticsSummary & { availableYears: number[] }> => {
  await resolveBranchAccess(branchId, actor);

  const now = new Date();
  const year = query.year ?? now.getUTCFullYear();
  const month = query.month ?? "All Months";
  const { start, end } = AnalyticsRepository.getYearMonthBounds(year, month);

  const [
    totalMembers,
    activeMembers,
    newAdmissions,
    chartRows,
    availableYears,
  ] = await Promise.all([
    AnalyticsRepository.countMembers(branchId),
    AnalyticsRepository.countActiveMembers(branchId, now),
    AnalyticsRepository.countNewMembers(branchId, start, end),
    AnalyticsRepository.getLastSixMonthsAdmissions(branchId),
    AnalyticsRepository.getAvailableYears(branchId),
  ]);

  const nowMonthIndex = now.getUTCMonth();
  const nowYear = now.getUTCFullYear();
  const monthTimeline: Array<{ year: number; month: number }> = [];
  for (let offset = 5; offset >= 0; offset -= 1) {
    const d = new Date(Date.UTC(nowYear, nowMonthIndex - offset, 1));
    monthTimeline.push({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 });
  }

  const chartMap = new Map<string, number>();
  chartRows.forEach((row: { year: number; month: number; value: number }) => {
    chartMap.set(`${row.year}-${row.month}`, row.value);
  });

  const admissionChart: TMemberAnalyticsPoint[] = monthTimeline.map((item) => ({
    month: monthShort[item.month - 1] || "",
    value: chartMap.get(`${item.year}-${item.month}`) ?? 0,
  }));

  const currentAdmissions = admissionChart[admissionChart.length - 1]?.value ?? 0;
  const previousAdmissions = admissionChart[admissionChart.length - 2]?.value ?? 0;

  return {
    totalMembers,
    activeMembers,
    newAdmissions,
    admissionChart,
    admissionChartPeriod: "Last six month",
    currentAdmissions,
    admissionGrowthPercent: percentageChange(currentAdmissions, previousAdmissions),
    availableYears,
  };
};

const getFinancialSummary = async (
  branchId: string,
  actor: TAnalyticsActor,
  query: TAnalyticsQuery,
): Promise<TFinancialAnalyticsSummary> => {
  await resolveBranchAccess(branchId, actor);

  const now = new Date();
  const year = query.year ?? now.getUTCFullYear();
  const month = query.month ?? "All Months";
  const { start, end } = AnalyticsRepository.getYearMonthBounds(year, month);

  let data: TFinancialAnalyticsPoint[] = [];

  if (month === "All Months") {
    const [incomeRows, expenseRows] = await AnalyticsRepository.getFinancialDataByMonth(
      branchId,
      year,
    );

    const incomeByMonth = new Map<number, number>();
    const expenseByMonth = new Map<number, number>();

    incomeRows.forEach((row: { _id: { month: number }; income: number }) => {
      incomeByMonth.set(row._id.month, row.income || 0);
    });
    expenseRows.forEach((row: { _id: { month: number }; expense: number }) => {
      expenseByMonth.set(row._id.month, row.expense || 0);
    });

    data = monthShort.map((name, idx) => ({
      period: name,
      income: incomeByMonth.get(idx + 1) ?? 0,
      expense: expenseByMonth.get(idx + 1) ?? 0,
    }));
  } else {
    const [incomeRows, expenseRows] = await AnalyticsRepository.getFinancialDataByDay(
      branchId,
      start,
      end,
    );

    const daysInMonth = new Date(Date.UTC(year, monthNames.indexOf(month) + 1, 0)).getUTCDate();
    const incomeByDay = new Map<number, number>();
    const expenseByDay = new Map<number, number>();

    incomeRows.forEach((row: { _id: { day: number }; income: number }) => {
      incomeByDay.set(row._id.day, row.income || 0);
    });
    expenseRows.forEach((row: { _id: { day: number }; expense: number }) => {
      expenseByDay.set(row._id.day, row.expense || 0);
    });

    data = Array.from({ length: daysInMonth }, (_, index) => {
      const day = index + 1;
      return {
        period: `${monthShort[monthNames.indexOf(month)]} ${day}`,
        income: incomeByDay.get(day) ?? 0,
        expense: expenseByDay.get(day) ?? 0,
      };
    });
  }

  const totalIncome = data.reduce((sum, item) => sum + item.income, 0);
  const totalExpense = data.reduce((sum, item) => sum + item.expense, 0);
  const totalNetIncome = totalIncome - totalExpense;

  const previousRange = (() => {
    if (month === "All Months") {
      return {
        start: new Date(Date.UTC(year - 1, 0, 1)),
        end: new Date(Date.UTC(year, 0, 1)),
      };
    }

    const monthIndex = monthNames.indexOf(month);
    return {
      start: new Date(Date.UTC(year, monthIndex - 1, 1)),
      end: new Date(Date.UTC(year, monthIndex, 1)),
    };
  })();

  const [prevIncomeRows, prevExpenseRows] = await AnalyticsRepository.getIncomeExpenseTotals(
    branchId,
    previousRange.start,
    previousRange.end,
  );

  const prevIncome = prevIncomeRows[0]?.total ?? 0;
  const prevExpense = prevExpenseRows[0]?.total ?? 0;
  const prevNet = prevIncome - prevExpense;

  const availableYears = await AnalyticsRepository.getAvailableYears(branchId);

  return {
    month,
    year,
    data,
    metrics: {
      totalIncome,
      totalExpense,
      totalNetIncome,
      incomeChangePercent: percentageChange(totalIncome, prevIncome),
      expenseChangePercent: percentageChange(totalExpense, prevExpense),
      netIncomeChangePercent: percentageChange(totalNetIncome, prevNet),
    },
    availableYears,
  };
};

const getCostSummary = async (
  branchId: string,
  actor: TAnalyticsActor,
  query: TAnalyticsQuery,
): Promise<TCostAnalyticsSummary> => {
  await resolveBranchAccess(branchId, actor);

  const now = new Date();
  const year = query.year ?? now.getUTCFullYear();
  const month = query.month ?? "All Months";
  const { start, end } = AnalyticsRepository.getYearMonthBounds(year, month);

  const [rows, availableYears] = await Promise.all([
    AnalyticsRepository.getExpenseBreakdown(branchId, start, end),
    AnalyticsRepository.getAvailableYears(branchId),
  ]);

  const totalCost = rows.reduce(
    (sum: number, row: { value: number }) => sum + (row.value || 0),
    0,
  );

  const categories = rows.map(
    (row: { _id: string; value: number }, index: number) => ({
      name: row._id || "Others",
      value: row.value || 0,
      percentage: totalCost > 0 ? Math.round(((row.value || 0) / totalCost) * 100) : 0,
      color: categoryPalette[index % categoryPalette.length] || "#67C090",
    }),
  );

  return {
    totalCost,
    month,
    year,
    categories,
    availableYears,
  };
};

const getPackagesSummary = async (
  branchId: string,
  actor: TAnalyticsActor,
  query: { year?: number },
): Promise<TPackagesAnalyticsSummary> => {
  await resolveBranchAccess(branchId, actor);

  const now = new Date();
  const year = query.year ?? now.getUTCFullYear();

  const [rows, availableYears] = await Promise.all([
    AnalyticsRepository.getPackageAnalytics(branchId, year),
    AnalyticsRepository.getAvailableYears(branchId),
  ]);

  const chartData = monthShort.map((monthName) => ({
    month: monthName,
    Weekly: 0,
    Monthly: 0,
    "Quarter Yearly": 0,
    "Half Yearly": 0,
    Yearly: 0,
  }));

  rows.forEach(
    (row: { _id: { month: number; packageType: string }; count: number }) => {
      const monthIndex = row._id.month - 1;
      if (monthIndex < 0 || monthIndex >= chartData.length) return;

      const point = chartData[monthIndex];
      if (!point) return;

      const packageType = row._id.packageType as
        | "Weekly"
        | "Monthly"
        | "Quarter Yearly"
        | "Half Yearly"
        | "Yearly";

      point[packageType] = row.count || 0;
    },
  );

  const totals = chartData.reduce(
    (acc, item) => {
      acc.Weekly += item.Weekly;
      acc.Monthly += item.Monthly;
      acc["Quarter Yearly"] += item["Quarter Yearly"];
      acc["Half Yearly"] += item["Half Yearly"];
      acc.Yearly += item.Yearly;
      return acc;
    },
    {
      Weekly: 0,
      Monthly: 0,
      "Quarter Yearly": 0,
      "Half Yearly": 0,
      Yearly: 0,
    },
  );

  const totalMembers =
    totals.Weekly +
    totals.Monthly +
    totals["Quarter Yearly"] +
    totals["Half Yearly"] +
    totals.Yearly;

  const toPercentage = (count: number) =>
    totalMembers > 0 ? Number(((count / totalMembers) * 100).toFixed(1)) : 0;

  return {
    year,
    chartData,
    stats: [
      { label: "Total Members", count: totalMembers, unit: "Person", percentage: 100 },
      { label: "Monthly", count: totals.Monthly, unit: "/per", percentage: toPercentage(totals.Monthly) },
      {
        label: "Half Yearly",
        count: totals["Half Yearly"],
        unit: "/per",
        percentage: toPercentage(totals["Half Yearly"]),
      },
      {
        label: "Quarter Yearly",
        count: totals["Quarter Yearly"],
        unit: "/per",
        percentage: toPercentage(totals["Quarter Yearly"]),
      },
      { label: "Yearly", count: totals.Yearly, unit: "/per", percentage: toPercentage(totals.Yearly) },
      { label: "Weekly", count: totals.Weekly, unit: "/per", percentage: toPercentage(totals.Weekly) },
    ],
    availableYears,
  };
};

const getCompareSummary = async (
  branchId: string,
  actor: TAnalyticsActor,
  query: TAnalyticsCompareQuery,
) => {
  await resolveBranchAccess(branchId, actor);

  const metric = query.metric;
  const years: number[] = [];
  for (let year = query.startYear; year <= query.endYear; year += 1) {
    years.push(year);
  }

  const [incomeRows, expenseRows] = await AnalyticsRepository.getCompareYearTotals(
    branchId,
    query.startYear,
    query.endYear,
  );

  const incomeMap = new Map<string, number>();
  const expenseMap = new Map<string, number>();

  incomeRows.forEach((row: { _id: { year: number; month: number }; income: number }) => {
    incomeMap.set(`${row._id.year}-${row._id.month}`, row.income || 0);
  });
  expenseRows.forEach((row: { _id: { year: number; month: number }; expense: number }) => {
    expenseMap.set(`${row._id.year}-${row._id.month}`, row.expense || 0);
  });

  const chartData: TCompareChartPoint[] = monthShort.map((name, index) => {
    const point: TCompareChartPoint = { month: name };
    years.forEach((year) => {
      const income = incomeMap.get(`${year}-${index + 1}`) ?? 0;
      const expense = expenseMap.get(`${year}-${index + 1}`) ?? 0;
      point[String(year)] = getMetricValue(metric, income, expense);
    });
    return point;
  });

  const tableData: TCompareTableRow[] = years.map((year) => {
    let income = 0;
    let expense = 0;
    for (let month = 1; month <= 12; month += 1) {
      income += incomeMap.get(`${year}-${month}`) ?? 0;
      expense += expenseMap.get(`${year}-${month}`) ?? 0;
    }

    return {
      date: String(year),
      income,
      expense,
      netIncome: income - expense,
    };
  });

  const balance = tableData.reduce((sum, row) => sum + row.netIncome, 0);

  return {
    metric,
    years,
    chartData,
    tableData,
    balance,
  };
};

const getOverviewSummary = async (
  branchId: string,
  actor: TAnalyticsActor,
  query: { year?: number; month?: string; transactionLimit?: number },
): Promise<TOverviewSummary> => {
  await resolveBranchAccess(branchId, actor);

  const now = new Date();
  const selectedYear = query.year ?? now.getUTCFullYear();
  const selectedMonth = query.month ?? monthNames[now.getUTCMonth()] ?? "January";
  const transactionLimit = query.transactionLimit ?? 20;

  const selectedRange = AnalyticsRepository.getYearMonthBounds(selectedYear, selectedMonth);
  const monthRange = AnalyticsRepository.getYearMonthBounds(selectedYear, selectedMonth);

  const [
    selectedTotals,
    monthMembers,
    yearlyProgressRows,
    monthlyIncomeRows,
    monthlyExpenseRows,
    expensePieRows,
    transactionRows,
    availableYears,
  ] = await Promise.all([
    AnalyticsRepository.getIncomeExpenseTotals(branchId, selectedRange.start, selectedRange.end),
    AnalyticsRepository.countNewMembers(branchId, monthRange.start, monthRange.end),
    AnalyticsRepository.getOverviewProgressYearly(branchId, selectedYear),
    AnalyticsRepository.getFinancialDataByMonth(branchId, selectedYear).then((value) => value[0]),
    AnalyticsRepository.getFinancialDataByMonth(branchId, selectedYear).then((value) => value[1]),
    AnalyticsRepository.getExpenseBreakdown(branchId, monthRange.start, monthRange.end),
    AnalyticsRepository.getOverviewRecentTransactions(branchId, transactionLimit),
    AnalyticsRepository.getAvailableYears(branchId),
  ]);

  const totalIncome = selectedTotals[0]?.[0]?.total ?? 0;
  const totalExpense = selectedTotals[1]?.[0]?.total ?? 0;

  const previousYearTotals = await AnalyticsRepository.getIncomeExpenseTotals(
    branchId,
    new Date(Date.UTC(selectedYear - 1, 0, 1)),
    new Date(Date.UTC(selectedYear, 0, 1)),
  );
  const previousYearIncome = previousYearTotals[0]?.[0]?.total ?? 0;
  const growthPercent = percentageChange(totalIncome, previousYearIncome);

  const yearlyMap = new Map<number, number>();
  yearlyProgressRows.forEach((row: { _id: { month: number }; value: number }) => {
    yearlyMap.set(row._id.month, row.value || 0);
  });

  const yearlyData = monthShort.map((name, idx) => ({
    month: name,
    value: yearlyMap.get(idx + 1) ?? 0,
  }));

  const monthIndex = monthNames.indexOf(selectedMonth);
  const daysInMonth = new Date(Date.UTC(selectedYear, monthIndex + 1, 0)).getUTCDate();

  const monthIncomeMap = new Map<number, number>();
  const monthExpenseMap = new Map<number, number>();
  monthlyIncomeRows.forEach((row: { _id: { month: number }; income: number }) => {
    monthIncomeMap.set(row._id.month, row.income || 0);
  });
  monthlyExpenseRows.forEach((row: { _id: { month: number }; expense: number }) => {
    monthExpenseMap.set(row._id.month, row.expense || 0);
  });

  const monthlyData = Array.from({ length: daysInMonth }, (_, index) => ({
    month: String(index + 1),
    value: 0,
  }));

  const pieTotal = expensePieRows.reduce(
    (sum: number, row: { value: number }) => sum + (row.value || 0),
    0,
  );

  const pieData = expensePieRows.map(
    (row: { _id: string; value: number }, index: number) => ({
      name: row._id || "Others",
      value: row.value || 0,
      color: categoryPalette[index % categoryPalette.length] || "#67C090",
    }),
  );

  const lineData = monthShort.map((name, idx) => ({
    period: name,
    income: monthIncomeMap.get(idx + 1) ?? 0,
    expense: monthExpenseMap.get(idx + 1) ?? 0,
  }));

  const lineIncomeTotal = lineData.reduce((sum, row) => sum + row.income, 0);
  const lineExpenseTotal = lineData.reduce((sum, row) => sum + row.expense, 0);
  const expensePercent = lineIncomeTotal > 0 ? (lineExpenseTotal / lineIncomeTotal) * 100 : 0;

  const paymentRows = transactionRows[0] ?? [];
  const expenseRows = transactionRows[1] ?? [];

  const merged: Array<{
    dateValue: Date;
    transaction: Omit<TOverviewTransaction, "balance">;
  }> = [];

  (paymentRows as Array<Record<string, unknown>>).forEach((row) => {
    const rawDate = row.paymentDate || row.createdAt;
    const dateValue = rawDate ? new Date(String(rawDate)) : new Date();

    merged.push({
      dateValue,
      transaction: {
        id: `#${String(row.invoiceNo || "PAY")}`,
        date: dateValue.toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        }),
        categoryName: String(row.memberName || row.paymentType || "Payment"),
        memberId: row.memberId ? String(row.memberId) : null,
        category:
          String(row.paymentType || "Other").charAt(0).toUpperCase() +
          String(row.paymentType || "Other").slice(1),
        payment: String(row.paymentMethod || "Cash"),
        amount: Number(row.paidTotal || 0),
      },
    });
  });

  (expenseRows as Array<Record<string, unknown>>).forEach((row) => {
    const rawDate = row.expenseDate || row.createdAt;
    const dateValue = rawDate ? new Date(String(rawDate)) : new Date();

    merged.push({
      dateValue,
      transaction: {
        id: `#${String(row.invoiceNo || "EXP")}`,
        date: dateValue.toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        }),
        categoryName: String(row.categoryTitle || "Expense"),
        memberId: null,
        category: "Expense",
        payment: String(row.paymentMethod || "Cash"),
        amount: Number(row.amount || 0),
      },
    });
  });

  merged.sort((a, b) => b.dateValue.getTime() - a.dateValue.getTime());

  let runningBalance = 0;
  const transactions: TOverviewTransaction[] = merged.slice(0, transactionLimit).map((item) => {
    const isExpense = item.transaction.category === "Expense";
    runningBalance += isExpense ? -item.transaction.amount : item.transaction.amount;

    return {
      ...item.transaction,
      balance: runningBalance,
    };
  });

  return {
    selectedYear,
    selectedMonth,
    stats: [
      {
        label: "Income",
        description: "Monthly income of your company",
        value: Number(totalIncome.toFixed(2)),
      },
      {
        label: "Expense",
        description: "Monthly expense of your company",
        value: Number(totalExpense.toFixed(2)),
      },
      {
        label: "New Member",
        description: "Total new members in this month",
        value: monthMembers,
        unit: "/Person",
      },
    ],
    progress: {
      yearlyData,
      monthlyData,
      totalValue: Number((yearlyData.reduce((sum, row) => sum + row.value, 0)).toFixed(2)),
      subtitle: `You achieved a ${growthPercent.toFixed(1)}% change in revenue over the previous year`,
    },
    pie: {
      centerValue: Number((pieTotal / 1000).toFixed(0)),
      description: "Your expenses share for the selected month",
      data: pieData,
    },
    line: {
      percentage: Number(expensePercent.toFixed(1)),
      data: lineData,
    },
    transactions,
    availableYears,
  };
};

export const AnalyticsService = {
  parseFilterQuery: (query: Record<string, unknown>): TAnalyticsQuery => {
    const currentYear = new Date().getUTCFullYear();
    return {
      year: toYear(query.year, currentYear),
      month: toMonth(query.month),
    };
  },

  parseCompareQuery: (query: Record<string, unknown>): TAnalyticsCompareQuery => {
    const currentYear = new Date().getUTCFullYear();
    const startYear = toYear(query.startYear, currentYear - 4);
    const endYear = toYear(query.endYear, currentYear);
    if (endYear < startYear) {
      throw new AppError(
        StatusCodes.BAD_REQUEST,
        "endYear must be greater than or equal to startYear",
      );
    }

    return {
      metric:
        (query.metric as "income" | "expense" | "netIncome") || "income",
      startYear,
      endYear,
    };
  },

  parseOverviewQuery: (query: Record<string, unknown>) => {
    const currentYear = new Date().getUTCFullYear();
    return {
      year: toYear(query.year, currentYear),
      month: toMonth(query.month),
      transactionLimit: toLimit(query.transactionLimit, 20),
    };
  },

  getMemberSummary,
  getFinancialSummary,
  getCostSummary,
  getPackagesSummary,
  getCompareSummary,
  getOverviewSummary,
};
