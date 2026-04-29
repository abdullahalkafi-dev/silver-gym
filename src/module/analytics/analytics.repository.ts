import { Types } from "mongoose";

import { Expense } from "../expense/expense.model";
import { Member } from "../member/member.model";
import { PaymentStatus } from "../payment/payment.interface";
import { Payment } from "../payment/payment.model";

type TYearMonthBounds = {
  start: Date;
  end: Date;
};

const monthToIndex = (month: string): number => {
  const months: Record<string, number> = {
    January: 0,
    February: 1,
    March: 2,
    April: 3,
    May: 4,
    June: 5,
    July: 6,
    August: 7,
    September: 8,
    October: 9,
    November: 10,
    December: 11,
  };

  return months[month] ?? -1;
};

const getYearMonthBounds = (year: number, month: string): TYearMonthBounds => {
  if (month !== "All Months") {
    const monthIndex = monthToIndex(month);
    const start = new Date(Date.UTC(year, monthIndex, 1, 0, 0, 0, 0));
    const end = new Date(Date.UTC(year, monthIndex + 1, 1, 0, 0, 0, 0));
    return { start, end };
  }

  const start = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year + 1, 0, 1, 0, 0, 0, 0));
  return { start, end };
};

const toBranchObjectId = (branchId: string) => new Types.ObjectId(branchId);

const validIncomeStatuses = [
  PaymentStatus.PAID,
  PaymentStatus.PARTIAL,
  PaymentStatus.DUE,
];

export const AnalyticsRepository = {
  getYearMonthBounds,

  async getAvailableYears(branchId: string) {
    const branchObjectId = toBranchObjectId(branchId);

    const [memberDoc, paymentDoc, expenseDoc] = await Promise.all([
      Member.findOne({ branchId: branchObjectId }).sort({ createdAt: 1 }).select("createdAt").lean(),
      Payment.findOne({ branchId: branchObjectId }).sort({ createdAt: 1 }).select("createdAt").lean(),
      Expense.findOne({ branchId: branchObjectId }).sort({ createdAt: 1 }).select("createdAt").lean(),
    ]);

    const currentYear = new Date().getUTCFullYear();
    const candidateYears = [
      memberDoc?.createdAt ? new Date(memberDoc.createdAt).getUTCFullYear() : currentYear,
      paymentDoc?.createdAt ? new Date(paymentDoc.createdAt).getUTCFullYear() : currentYear,
      expenseDoc?.createdAt ? new Date(expenseDoc.createdAt).getUTCFullYear() : currentYear,
    ];

    const minYear = Math.min(...candidateYears, currentYear);
    const years: number[] = [];
    for (let year = minYear; year <= currentYear; year += 1) {
      years.push(year);
    }

    return years;
  },

  countMembers(branchId: string) {
    return Member.countDocuments({ branchId: toBranchObjectId(branchId), isActive: true });
  },

  countActiveMembers(branchId: string, now: Date) {
    return Member.countDocuments({
      branchId: toBranchObjectId(branchId),
      isActive: true,
      $or: [{ membershipEndDate: { $gte: now } }, { membershipEndDate: { $exists: false } }],
    });
  },

  countNewMembers(branchId: string, start: Date, end: Date) {
    return Member.countDocuments({
      branchId: toBranchObjectId(branchId),
      isActive: true,
      createdAt: { $gte: start, $lt: end },
    });
  },

  getLastSixMonthsAdmissions(branchId: string) {
    const now = new Date();
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));

    return Member.aggregate([
      {
        $match: {
          branchId: toBranchObjectId(branchId),
          isActive: true,
          createdAt: { $gte: start, $lt: end },
        },
      },
      {
        $group: {
          _id: {
            year: { $year: "$createdAt" },
            month: { $month: "$createdAt" },
          },
          value: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          year: "$_id.year",
          month: "$_id.month",
          value: 1,
        },
      },
      { $sort: { year: 1, month: 1 } },
    ]);
  },

  getFinancialDataByMonth(branchId: string, year: number) {
    const start = new Date(Date.UTC(year, 0, 1));
    const end = new Date(Date.UTC(year + 1, 0, 1));

    return Promise.all([
      Payment.aggregate([
        {
          $match: {
            branchId: toBranchObjectId(branchId),
            status: { $in: validIncomeStatuses },
            paymentDate: { $gte: start, $lt: end },
          },
        },
        {
          $group: {
            _id: { month: { $month: "$paymentDate" } },
            income: { $sum: { $ifNull: ["$paidTotal", 0] } },
          },
        },
      ]),
      Expense.aggregate([
        {
          $match: {
            branchId: toBranchObjectId(branchId),
            isActive: true,
            expenseDate: { $gte: start, $lt: end },
          },
        },
        {
          $group: {
            _id: { month: { $month: "$expenseDate" } },
            expense: { $sum: { $ifNull: ["$amount", 0] } },
          },
        },
      ]),
    ]);
  },

  getFinancialDataByDay(branchId: string, start: Date, end: Date) {
    return Promise.all([
      Payment.aggregate([
        {
          $match: {
            branchId: toBranchObjectId(branchId),
            status: { $in: validIncomeStatuses },
            paymentDate: { $gte: start, $lt: end },
          },
        },
        {
          $group: {
            _id: { day: { $dayOfMonth: "$paymentDate" } },
            income: { $sum: { $ifNull: ["$paidTotal", 0] } },
          },
        },
      ]),
      Expense.aggregate([
        {
          $match: {
            branchId: toBranchObjectId(branchId),
            isActive: true,
            expenseDate: { $gte: start, $lt: end },
          },
        },
        {
          $group: {
            _id: { day: { $dayOfMonth: "$expenseDate" } },
            expense: { $sum: { $ifNull: ["$amount", 0] } },
          },
        },
      ]),
    ]);
  },

  getIncomeExpenseTotals(branchId: string, start: Date, end: Date) {
    return Promise.all([
      Payment.aggregate([
        {
          $match: {
            branchId: toBranchObjectId(branchId),
            status: { $in: validIncomeStatuses },
            paymentDate: { $gte: start, $lt: end },
          },
        },
        { $group: { _id: null, total: { $sum: { $ifNull: ["$paidTotal", 0] } } } },
      ]),
      Expense.aggregate([
        {
          $match: {
            branchId: toBranchObjectId(branchId),
            isActive: true,
            expenseDate: { $gte: start, $lt: end },
          },
        },
        { $group: { _id: null, total: { $sum: { $ifNull: ["$amount", 0] } } } },
      ]),
    ]);
  },

  getExpenseBreakdown(branchId: string, start: Date, end: Date) {
    return Expense.aggregate([
      {
        $match: {
          branchId: toBranchObjectId(branchId),
          isActive: true,
          expenseDate: { $gte: start, $lt: end },
        },
      },
      {
        $group: {
          _id: { $ifNull: ["$categoryTitle", "Others"] },
          value: { $sum: { $ifNull: ["$amount", 0] } },
        },
      },
      { $sort: { value: -1 } },
    ]);
  },

  getPackageAnalytics(branchId: string, year: number) {
    const start = new Date(Date.UTC(year, 0, 1));
    const end = new Date(Date.UTC(year + 1, 0, 1));

    return Payment.aggregate([
      {
        $match: {
          branchId: toBranchObjectId(branchId),
          status: { $in: validIncomeStatuses },
          paymentDate: { $gte: start, $lt: end },
        },
      },
      {
        $project: {
          month: { $month: "$paymentDate" },
          packageDuration: { $ifNull: ["$packageDuration", 0] },
          packageDurationType: { $ifNull: ["$packageDurationType", ""] },
        },
      },
      {
        $project: {
          month: 1,
          packageType: {
            $switch: {
              branches: [
                {
                  case: { $eq: ["$packageDurationType", "week"] },
                  then: "Weekly",
                },
                {
                  case: {
                    $and: [
                      { $eq: ["$packageDurationType", "month"] },
                      { $eq: ["$packageDuration", 1] },
                    ],
                  },
                  then: "Monthly",
                },
                {
                  case: {
                    $and: [
                      { $eq: ["$packageDurationType", "month"] },
                      { $eq: ["$packageDuration", 3] },
                    ],
                  },
                  then: "Quarter Yearly",
                },
                {
                  case: {
                    $and: [
                      { $eq: ["$packageDurationType", "month"] },
                      { $eq: ["$packageDuration", 6] },
                    ],
                  },
                  then: "Half Yearly",
                },
                {
                  case: {
                    $or: [
                      { $eq: ["$packageDurationType", "year"] },
                      {
                        $and: [
                          { $eq: ["$packageDurationType", "month"] },
                          { $gte: ["$packageDuration", 12] },
                        ],
                      },
                    ],
                  },
                  then: "Yearly",
                },
              ],
              default: "Monthly",
            },
          },
        },
      },
      {
        $group: {
          _id: {
            month: "$month",
            packageType: "$packageType",
          },
          count: { $sum: 1 },
        },
      },
    ]);
  },

  getCompareYearTotals(branchId: string, startYear: number, endYear: number) {
    const start = new Date(Date.UTC(startYear, 0, 1));
    const end = new Date(Date.UTC(endYear + 1, 0, 1));

    return Promise.all([
      Payment.aggregate([
        {
          $match: {
            branchId: toBranchObjectId(branchId),
            status: { $in: validIncomeStatuses },
            paymentDate: { $gte: start, $lt: end },
          },
        },
        {
          $group: {
            _id: {
              year: { $year: "$paymentDate" },
              month: { $month: "$paymentDate" },
            },
            income: { $sum: { $ifNull: ["$paidTotal", 0] } },
          },
        },
      ]),
      Expense.aggregate([
        {
          $match: {
            branchId: toBranchObjectId(branchId),
            isActive: true,
            expenseDate: { $gte: start, $lt: end },
          },
        },
        {
          $group: {
            _id: {
              year: { $year: "$expenseDate" },
              month: { $month: "$expenseDate" },
            },
            expense: { $sum: { $ifNull: ["$amount", 0] } },
          },
        },
      ]),
    ]);
  },

  getOverviewProgressYearly(branchId: string, year: number) {
    const start = new Date(Date.UTC(year, 0, 1));
    const end = new Date(Date.UTC(year + 1, 0, 1));

    return Payment.aggregate([
      {
        $match: {
          branchId: toBranchObjectId(branchId),
          status: { $in: validIncomeStatuses },
          paymentDate: { $gte: start, $lt: end },
        },
      },
      {
        $group: {
          _id: { month: { $month: "$paymentDate" } },
          value: { $sum: { $ifNull: ["$paidTotal", 0] } },
        },
      },
    ]);
  },

  getOverviewRecentTransactions(branchId: string, limit: number) {
    return Promise.all([
      Payment.find({
        branchId: toBranchObjectId(branchId),
        status: { $in: validIncomeStatuses },
      })
        .select("invoiceNo paymentDate createdAt memberId memberName paymentType paymentMethod paidTotal")
        .sort({ paymentDate: -1, createdAt: -1 })
        .limit(limit)
        .lean(),
      Expense.find({ branchId: toBranchObjectId(branchId), isActive: true })
        .select("invoiceNo expenseDate createdAt categoryTitle paymentMethod amount")
        .sort({ expenseDate: -1, createdAt: -1 })
        .limit(limit)
        .lean(),
    ]);
  },
};
