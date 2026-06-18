import { StatusCodes } from "http-status-codes";
import { Types } from "mongoose";

import AppError from "../../errors/AppError";
import { BD_OFFSET_MS } from "../../utils/dhakaTime";
import cacheService from "../../redis-client/cacheService";
import { BranchRepository } from "../branch/branch.repository";
import { BusinessProfileRepository } from "../businessProfile/businessProfile.repository";
import { PackageRepository } from "../package/package.repository";
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
  TPackageListItem,
  TPackagesAnalyticsSummary,
  TTodaySummary,
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

const incomePalette = [
  "#4CAF50",
  "#2196F3",
  "#00BCD4",
  "#9C27B0",
  "#FF9800",
  "#795548",
];

const ANALYTICS_CACHE_TTL = 120; // 2 minutes
const ANALYTICS_TODAY_CACHE_TTL = 60; // 1 minute for today's summary

const getAnalyticsCacheKey = (branchId: string, fn: string, ...parts: (string | number)[]) => {
  return `analytics:${branchId}:${fn}:${parts.join(":")}`;
};

const getBDDate = (date?: Date) => {
  const d = date || new Date();
  return new Date(d.getTime() + BD_OFFSET_MS);
};

const formatBDDateTime = (date: Date) => {
  const bdDate = new Date(date.getTime() + BD_OFFSET_MS);
  const day = String(bdDate.getUTCDate()).padStart(2, "0");
  const month = monthShort[bdDate.getUTCMonth()];
  const year = bdDate.getUTCFullYear();
  let hours = bdDate.getUTCHours();
  const minutes = String(bdDate.getUTCMinutes()).padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  return `${day} ${month} ${year}, ${hours}:${minutes} ${ampm}`;
};

const toYear = (value: unknown, fallback: number) => {
  if (typeof value !== "string") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 2000 || parsed > 2200) return fallback;
  return parsed;
};

const toMonth = (value: unknown) => {
  if (typeof value !== "string" || value.length === 0) return undefined;
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
  const bdNow = getBDDate(now);
  const year = query.year ?? bdNow.getUTCFullYear();
  const month = query.month ?? "All Months";

  const cacheKey = getAnalyticsCacheKey(branchId, "member", year, month);
  const cached = await cacheService.getCache<TMemberAnalyticsSummary & { availableYears: number[] }>(cacheKey);
  if (cached) return cached;

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

  const nowMonthIndex = bdNow.getUTCMonth();
  const nowYear = bdNow.getUTCFullYear();
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

  const result = {
    totalMembers,
    activeMembers,
    newAdmissions,
    admissionChart,
    admissionChartPeriod: "Last six month",
    currentAdmissions,
    admissionGrowthPercent: percentageChange(currentAdmissions, previousAdmissions),
    availableYears,
  };

  await cacheService.setCache(cacheKey, result, ANALYTICS_CACHE_TTL);
  return result;
};

const getFinancialSummary = async (
  branchId: string,
  actor: TAnalyticsActor,
  query: TAnalyticsQuery,
): Promise<TFinancialAnalyticsSummary> => {
  await resolveBranchAccess(branchId, actor);

  const bdNow = getBDDate();
  const year = query.year ?? bdNow.getUTCFullYear();
  const month = query.month ?? "All Months";

  const cacheKey = getAnalyticsCacheKey(branchId, "financial", year, month);
  const cached = await cacheService.getCache<TFinancialAnalyticsSummary>(cacheKey);
  if (cached) return cached;

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

  const result = {
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

  await cacheService.setCache(cacheKey, result, ANALYTICS_CACHE_TTL);
  return result;
};

const getCostSummary = async (
  branchId: string,
  actor: TAnalyticsActor,
  query: TAnalyticsQuery,
): Promise<TCostAnalyticsSummary> => {
  await resolveBranchAccess(branchId, actor);

  const bdNow = getBDDate();
  const year = query.year ?? bdNow.getUTCFullYear();
  const month = query.month ?? "All Months";

  const cacheKey = getAnalyticsCacheKey(branchId, "cost", year, month);
  const cached = await cacheService.getCache<TCostAnalyticsSummary>(cacheKey);
  if (cached) return cached;

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

  const result = {
    totalCost,
    month,
    year,
    categories,
    availableYears,
  };

  await cacheService.setCache(cacheKey, result, ANALYTICS_CACHE_TTL);
  return result;
};

const getPackagesSummary = async (
  branchId: string,
  actor: TAnalyticsActor,
  query: { year?: number },
): Promise<TPackagesAnalyticsSummary> => {
  await resolveBranchAccess(branchId, actor);

  const bdNow = getBDDate();
  const year = query.year ?? bdNow.getUTCFullYear();

  const cacheKey = getAnalyticsCacheKey(branchId, "packages", year);
  const cached = await cacheService.getCache<TPackagesAnalyticsSummary>(cacheKey);
  if (cached) return cached;

  const [joinRows, availableYears, packageDocs, memberPackageRows] = await Promise.all([
    AnalyticsRepository.getMemberJoinChart(branchId, year),
    AnalyticsRepository.getAvailableYears(branchId),
    PackageRepository.findMany({ branchId: new Types.ObjectId(branchId), isActive: true }),
    AnalyticsRepository.getMemberPackageSummary(branchId),
  ]);

  const chartData = monthShort.map((monthName) => ({
    month: monthName,
    Weekly: 0,
    Monthly: 0,
    "Quarter Yearly": 0,
    "Half Yearly": 0,
    Yearly: 0,
  }));

  const packageTitleSet = new Set<string>();

  const packageRows: Array<{
    month: number;
    packageType: string;
    packageTitle: string;
    count: number;
  }> = [];

  joinRows.forEach(
    (row: { _id: { month: number; packageTitle: string }; count: number }) => {
      const monthIndex = row._id.month - 1;
      if (monthIndex < 0 || monthIndex >= chartData.length) return;

      const point = chartData[monthIndex];
      if (!point) return;

      if (!row._id.packageTitle) {
        // No package (imported or purely monthly members) → Monthly bucket
        point["Monthly"] += row.count || 0;
      }

      if (row._id.packageTitle) {
        packageTitleSet.add(row._id.packageTitle);
      }

      packageRows.push({
        month: row._id.month,
        packageType: row._id.packageTitle ? "Package" : "Monthly",
        packageTitle: row._id.packageTitle || "",
        count: row.count || 0,
      });
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

  const memberPackageSummary: Array<{
    packageId: string | null;
    packageTitle: string;
    count: number;
  }> = (
    memberPackageRows as Array<{
      _id: { packageId: import("mongoose").Types.ObjectId | null; packageTitle: string };
      count: number;
    }>
  ).map((row) => ({
    packageId: row._id.packageId ? row._id.packageId.toString() : null,
    packageTitle: row._id.packageTitle || "",
    count: row.count,
  }));

  const totalActiveMembers = memberPackageSummary.reduce((sum, r) => sum + r.count, 0);

  const toPercentage = (count: number) =>
    totalActiveMembers > 0 ? Number(((count / totalActiveMembers) * 100).toFixed(1)) : 0;

  const packagesList: TPackageListItem[] = [
    ...packageDocs
      .filter((doc: { _id: { toString(): string }; title: string; color?: string }) =>
        doc.title !== "Monthly Renewal"
      )
      .map((doc: { _id: { toString(): string }; title: string; color?: string }) => ({
        id: doc._id.toString(),
        title: doc.title,
        color: doc.color || "#7C3AED",
      })),
  ];

  const statsArray = [
    { label: "Monthly", count: totals.Monthly },
    { label: "Half Yearly", count: totals["Half Yearly"] },
    { label: "Quarter Yearly", count: totals["Quarter Yearly"] },
    { label: "Yearly", count: totals.Yearly },
    { label: "Weekly", count: totals.Weekly },
  ].filter((item) => item.count > 0);

  const result: TPackagesAnalyticsSummary = {
    year,
    chartData,
    stats: [
      { label: "Total Members", count: totalActiveMembers, unit: "Person", percentage: 100 },
      ...statsArray.map((item) => ({
        label: item.label,
        count: item.count,
        unit: "/per",
        percentage: toPercentage(item.count),
      })),
    ],
    packagesList,
    packageRows,
    memberPackageSummary,
    availableYears,
  };

  await cacheService.setCache(cacheKey, result, ANALYTICS_CACHE_TTL);
  return result;
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

  const cacheKey = getAnalyticsCacheKey(branchId, "compare", query.startYear, query.endYear, query.metric);
  const cached = await cacheService.getCache<{ metric: string; years: number[]; chartData: TCompareChartPoint[]; tableData: TCompareTableRow[]; balance: number }>(cacheKey);
  if (cached) return cached;

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

  const result = {
    metric,
    years,
    chartData,
    tableData,
    balance,
  };

  await cacheService.setCache(cacheKey, result, ANALYTICS_CACHE_TTL);
  return result;
};

const getOverviewSummary = async (
  branchId: string,
  actor: TAnalyticsActor,
  query: { year?: number; month?: string; transactionLimit?: number },
): Promise<TOverviewSummary> => {
  await resolveBranchAccess(branchId, actor);

  const branch = await BranchRepository.findById(branchId);
  const startingBalance = branch?.startingBalance ?? null;

  const bdNow = getBDDate();
  const selectedYear = query.year ?? bdNow.getUTCFullYear();
  const selectedMonth = query.month ?? monthNames[bdNow.getUTCMonth()] ?? "January";
  const transactionLimit = query.transactionLimit ?? 20;

  const cacheKey = getAnalyticsCacheKey(branchId, "overview", selectedYear, selectedMonth, transactionLimit);
  const cached = await cacheService.getCache<TOverviewSummary>(cacheKey);
  if (cached) return cached;

  const selectedRange = AnalyticsRepository.getYearMonthBounds(selectedYear, selectedMonth);
  const monthRange = AnalyticsRepository.getYearMonthBounds(selectedYear, selectedMonth);

  const [
    selectedTotals,
    monthMembers,
    yearlyProgressRows,
    financialData,
    expensePieRows,
    incomePieRows,
    transactionRows,
    availableYears,
    dailyProgressRows,
    allTimeTotals,
    previousYearTotals,
  ] = await Promise.all([
    AnalyticsRepository.getIncomeExpenseTotals(branchId, selectedRange.start, selectedRange.end),
    AnalyticsRepository.countNewMembers(branchId, monthRange.start, monthRange.end),
    AnalyticsRepository.getOverviewProgressYearly(branchId, selectedYear),
    AnalyticsRepository.getFinancialDataByMonth(branchId, selectedYear),
    AnalyticsRepository.getExpenseBreakdown(branchId, monthRange.start, monthRange.end),
    AnalyticsRepository.getIncomeBreakdown(branchId, monthRange.start, monthRange.end),
    AnalyticsRepository.getOverviewRecentTransactions(branchId, transactionLimit),
    AnalyticsRepository.getAvailableYears(branchId),
    AnalyticsRepository.getFinancialDataByDay(branchId, monthRange.start, monthRange.end).then((value) => value[0]),
    startingBalance !== null
      ? AnalyticsRepository.getAllTimeIncomeExpenseTotals(branchId)
      : Promise.resolve([[], []] as [Array<{ total: number }>, Array<{ total: number }>]),
    AnalyticsRepository.getIncomeExpenseTotals(
      branchId,
      new Date(Date.UTC(selectedYear - 1, 0, 1)),
      new Date(Date.UTC(selectedYear, 0, 1)),
    ),
  ]);

  const monthlyIncomeRows = financialData[0];
  const monthlyExpenseRows = financialData[1];

  const totalIncome = selectedTotals[0]?.[0]?.total ?? 0;
  const totalExpense = selectedTotals[1]?.[0]?.total ?? 0;

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

  const dailyIncomeMap = new Map<number, number>();
  (dailyProgressRows as Array<{ _id: { day: number }; income: number }>).forEach((row) => {
    dailyIncomeMap.set(row._id.day, row.income || 0);
  });

  // Determine the current BD day so we can zero out future days when viewing the current month
  const todayBD = getBDDate();
  const isCurrentMonth =
    todayBD.getUTCFullYear() === selectedYear &&
    todayBD.getUTCMonth() === monthNames.indexOf(selectedMonth);
  const todayBDDay = todayBD.getUTCDate();

  const monthlyData = Array.from({ length: daysInMonth }, (_, index) => {
    const day = index + 1;
    const value = isCurrentMonth && day > todayBDDay ? 0 : (dailyIncomeMap.get(day) ?? 0);
    return { month: String(day), value };
  });

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

  const incomePieTotal = incomePieRows.reduce(
    (sum: number, row: { value: number }) => sum + (row.value || 0),
    0,
  );

  const incomePieData = incomePieRows.map(
    (row: { _id: string; value: number }, index: number) => ({
      name: row._id ? row._id.charAt(0).toUpperCase() + row._id.slice(1) : "Other",
      value: row.value || 0,
      color: incomePalette[index % incomePalette.length] || "#4CAF50",
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

  (paymentRows as unknown as Array<Record<string, unknown>>).forEach((row) => {
    const rawDate = row.paymentDate || row.createdAt;
    const dateValue = rawDate ? new Date(String(rawDate)) : new Date();

    merged.push({
      dateValue,
      transaction: {
        id: `#${String(row.invoiceNo)}`,
        date: formatBDDateTime(dateValue),
        categoryName: String(row.memberName || row.paymentType || "Payment"),
        memberId: row.memberId ? String(row.memberId) : null,
        memberCustomId: row.memberCustomId ? String(row.memberCustomId) : null,
        category:
          String(row.paymentType || "Other").charAt(0).toUpperCase() +
          String(row.paymentType || "Other").slice(1),
        payment: String(row.paymentMethod || "Cash"),
        amount: Number(row.paidTotal || 0),
        type: "income" as const,
        description: String(row.memberName || ""),
      },
    });
  });

  (expenseRows as unknown as Array<Record<string, unknown>>).forEach((row) => {
    const rawDate = row.expenseDate || row.createdAt;
    const dateValue = rawDate ? new Date(String(rawDate)) : new Date();

    merged.push({
      dateValue,
      transaction: {
        id: `#${String(row.invoiceNo)}`,
        date: formatBDDateTime(dateValue),
        categoryName: String(row.categoryTitle || "Expense"),
        memberId: null,
        memberCustomId: null,
        category: "Expense",
        payment: String(row.paymentMethod || "Cash"),
        amount: Number(row.amount || 0),
        type: "expense" as const,
        description: String(row.description || ""),
      },
    });
  });

  merged.sort((a, b) => b.dateValue.getTime() - a.dateValue.getTime());

  let transactionRunningBalance = 0;
  const transactions: TOverviewTransaction[] = merged.slice(0, transactionLimit).map((item) => {
    const isExpense = item.transaction.category === "Expense";
    transactionRunningBalance += isExpense ? -item.transaction.amount : item.transaction.amount;

    return {
      ...item.transaction,
      balance: transactionRunningBalance,
    };
  });

  const allTimeIncome = allTimeTotals[0]?.[0]?.total ?? 0;
  const allTimeExpense = allTimeTotals[1]?.[0]?.total ?? 0;
  const branchRunningBalance =
    startingBalance !== null
      ? Number((startingBalance + allTimeIncome - allTimeExpense).toFixed(2))
      : null;

  // Calculate today's net from all today's transactions (before limit slicing)
  const todayNet = merged.reduce((sum, item) => {
    return sum + (item.transaction.category === "Expense" ? -item.transaction.amount : item.transaction.amount);
  }, 0);

  const openingBalanceBeforeToday =
    branchRunningBalance !== null
      ? Number((branchRunningBalance - todayNet).toFixed(2))
      : 0;

  const stats = [
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
  ];

  if (branchRunningBalance !== null) {
    stats.push({
      label: "Balance",
      description: "Running balance since initialization",
      value: branchRunningBalance,
    });
  }

  const overviewResult: TOverviewSummary = {
    selectedYear,
    selectedMonth,
    stats,
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
    incomePie: {
      centerValue: Number((incomePieTotal / 1000).toFixed(0)),
      description: "Your income share for the selected month",
      data: incomePieData,
    },
    line: {
      percentage: Number(expensePercent.toFixed(1)),
      data: lineData,
    },
    transactions,
    availableYears,
    runningBalance: branchRunningBalance,
    openingBalanceBeforeToday,
  };

  await cacheService.setCache(cacheKey, overviewResult, ANALYTICS_CACHE_TTL);
  return overviewResult;
};

const getTodaySummary = async (
  branchId: string,
  actor: TAnalyticsActor,
): Promise<TTodaySummary> => {
  await resolveBranchAccess(branchId, actor);

  const cacheKey = getAnalyticsCacheKey(branchId, "today");
  const cached = await cacheService.getCache<TTodaySummary>(cacheKey);
  if (cached) return cached;

  const branch = await BranchRepository.findById(branchId);
  const startingBalance = branch?.startingBalance ?? 0;

  const [todayTotals, allTimeTotals] = await Promise.all([
    AnalyticsRepository.getTodayIncomeExpenseSummary(branchId),
    AnalyticsRepository.getAllTimeIncomeExpenseTotals(branchId),
  ]);

  const todayIncome = todayTotals[0]?.[0]?.total ?? 0;
  const todayExpense = todayTotals[1]?.[0]?.total ?? 0;
  const todayIncomeCount = todayTotals[0]?.[0]?.count ?? 0;
  const todayExpenseCount = todayTotals[1]?.[0]?.count ?? 0;

  const todayNet = todayIncome - todayExpense;

  const allTimeIncome = allTimeTotals[0]?.[0]?.total ?? 0;
  const allTimeExpense = allTimeTotals[1]?.[0]?.total ?? 0;
  const branchRunningBalance = Number((startingBalance + allTimeIncome - allTimeExpense).toFixed(2));
  const openingBalance = Number((branchRunningBalance - todayNet).toFixed(2));

  const result: TTodaySummary = {
    todayIncome: Number(todayIncome.toFixed(2)),
    todayExpense: Number(todayExpense.toFixed(2)),
    todayIncomeCount,
    todayExpenseCount,
    openingBalance,
  };

  await cacheService.setCache(cacheKey, result, ANALYTICS_TODAY_CACHE_TTL);
  return result;
};

export const AnalyticsService = {
  parseFilterQuery: (query: Record<string, unknown>): TAnalyticsQuery => {
    const currentYear = getBDDate().getUTCFullYear();
    return {
      year: toYear(query.year, currentYear),
      month: toMonth(query.month),
    };
  },

  parseCompareQuery: (query: Record<string, unknown>): TAnalyticsCompareQuery => {
    const currentYear = getBDDate().getUTCFullYear();
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
    const currentYear = getBDDate().getUTCFullYear();
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
  getTodaySummary,
};
