import { Types } from "mongoose";

export type TAnalyticsActor = {
  userId?: Types.ObjectId;
  staff?: {
    _id?: Types.ObjectId | string;
    isActive?: boolean;
    branchId?: Types.ObjectId | string;
  };
};

export type TAnalyticsQuery = {
  year?: number;
  month?: string;
};

export type TFinancialCompareMetric = "income" | "expense" | "netIncome";

export type TAnalyticsCompareQuery = {
  metric: TFinancialCompareMetric;
  startYear: number;
  endYear: number;
};

export type TOverviewQuery = {
  year?: number;
  month?: string;
  transactionLimit?: number;
};

export type TMemberAnalyticsPoint = {
  month: string;
  value: number;
};

export type TMemberAnalyticsSummary = {
  totalMembers: number;
  newAdmissions: number;
  activeMembers: number;
  admissionChart: TMemberAnalyticsPoint[];
  admissionChartPeriod: string;
  currentAdmissions: number;
  admissionGrowthPercent: number;
};

export type TFinancialAnalyticsPoint = {
  period: string;
  income: number;
  expense: number;
};

export type TFinancialAnalyticsMetrics = {
  totalIncome: number;
  totalExpense: number;
  totalNetIncome: number;
  incomeChangePercent: number;
  expenseChangePercent: number;
  netIncomeChangePercent: number;
};

export type TFinancialAnalyticsSummary = {
  month: string;
  year: number;
  data: TFinancialAnalyticsPoint[];
  metrics: TFinancialAnalyticsMetrics;
  availableYears: number[];
};

export type TCostCategoryPoint = {
  name: string;
  value: number;
  percentage: number;
  color: string;
};

export type TCostAnalyticsSummary = {
  totalCost: number;
  month: string;
  year: number;
  categories: TCostCategoryPoint[];
  availableYears: number[];
};

export type TPackagesChartPoint = {
  month: string;
  Weekly: number;
  Monthly: number;
  "Quarter Yearly": number;
  "Half Yearly": number;
  Yearly: number;
};

export type TPackageStat = {
  label: string;
  count: number;
  unit: string;
  percentage: number;
};

export type TPackagesAnalyticsSummary = {
  year: number;
  chartData: TPackagesChartPoint[];
  stats: TPackageStat[];
  availableYears: number[];
};

export type TCompareChartPoint = {
  month: string;
  [year: string]: string | number;
};

export type TCompareTableRow = {
  date: string;
  income: number;
  expense: number;
  netIncome: number;
};

export type TFinancialCompareSummary = {
  metric: TFinancialCompareMetric;
  years: number[];
  chartData: TCompareChartPoint[];
  tableData: TCompareTableRow[];
  balance: number;
};

export type TOverviewStatsItem = {
  label: string;
  description: string;
  value: string | number;
  unit?: string;
};

export type TOverviewBarPoint = {
  month: string;
  value: number;
};

export type TOverviewPiePoint = {
  name: string;
  value: number;
  color: string;
};

export type TOverviewLinePoint = {
  period: string;
  income: number;
  expense: number;
};

export type TOverviewTransaction = {
  id: string;
  date: string;
  categoryName: string;
  memberId: string | null;
  category: string;
  payment: string;
  amount: number;
  balance: number;
};

export type TOverviewSummary = {
  selectedYear: number;
  selectedMonth: string;
  stats: TOverviewStatsItem[];
  progress: {
    yearlyData: TOverviewBarPoint[];
    monthlyData: TOverviewBarPoint[];
    totalValue: number;
    subtitle: string;
  };
  pie: {
    centerValue: number;
    description: string;
    data: TOverviewPiePoint[];
  };
  line: {
    percentage: number;
    data: TOverviewLinePoint[];
  };
  transactions: TOverviewTransaction[];
  availableYears: number[];
};
