import { Types } from "mongoose";

import { BD_OFFSET_MS } from "../../utils/dhakaTime";
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
    const start = new Date(Date.UTC(year, monthIndex, 1, 0, 0, 0, 0) - BD_OFFSET_MS);
    const end = new Date(Date.UTC(year, monthIndex + 1, 1, 0, 0, 0, 0) - BD_OFFSET_MS);
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

    const currentYear = new Date(Date.now() + BD_OFFSET_MS).getUTCFullYear();
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
    const bdNow = new Date(now.getTime() + BD_OFFSET_MS);
    const end = new Date(Date.UTC(bdNow.getUTCFullYear(), bdNow.getUTCMonth() + 1, 1) - BD_OFFSET_MS);
    const start = new Date(Date.UTC(bdNow.getUTCFullYear(), bdNow.getUTCMonth() - 5, 1) - BD_OFFSET_MS);

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
            year: { $year: { $add: ["$createdAt", BD_OFFSET_MS] } },
            month: { $month: { $add: ["$createdAt", BD_OFFSET_MS] } },
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
    const start = new Date(Date.UTC(year, 0, 1) - BD_OFFSET_MS);
    const end = new Date(Date.UTC(year + 1, 0, 1) - BD_OFFSET_MS);

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
            _id: { month: { $month: { $add: ["$paymentDate", BD_OFFSET_MS] } } },
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
            _id: { month: { $month: { $add: ["$expenseDate", BD_OFFSET_MS] } } },
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
            _id: { day: { $dayOfMonth: { $add: ["$paymentDate", BD_OFFSET_MS] } } },
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
            _id: { day: { $dayOfMonth: { $add: ["$expenseDate", BD_OFFSET_MS] } } },
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
    const start = new Date(Date.UTC(year, 0, 1) - BD_OFFSET_MS);
    const end = new Date(Date.UTC(year + 1, 0, 1) - BD_OFFSET_MS);

    return Payment.aggregate([
      {
        $match: {
          branchId: toBranchObjectId(branchId),
          status: { $in: validIncomeStatuses },
          paymentDate: { $gte: start, $lt: end },
          packageId: { $exists: true, $ne: null },
        },
      },
      {
        $project: {
          month: { $month: { $add: ["$paymentDate", BD_OFFSET_MS] } },
          packageId: 1,
          packageDuration: { $ifNull: ["$packageDuration", 0] },
          packageDurationType: { $ifNull: ["$packageDurationType", ""] },
          packageTitle: { $ifNull: ["$packageName", ""] },
        },
      },
      {
        $project: {
          month: 1,
          packageId: 1,
          packageTitle: 1,
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
        $lookup: {
          from: "packages",
          localField: "packageId",
          foreignField: "_id",
          as: "pkgDoc",
        },
      },
      {
        $addFields: {
          packageTitle: {
            $ifNull: [{ $arrayElemAt: ["$pkgDoc.title", 0] }, "$packageTitle"],
          },
        },
      },
      {
        $project: {
          month: 1,
          packageTitle: 1,
          packageType: 1,
        },
      },
      {
        $group: {
          _id: {
            month: "$month",
            packageType: "$packageType",
            packageTitle: "$packageTitle",
          },
          count: { $sum: 1 },
        },
      },
    ]);
  },

  getMemberJoinChart(branchId: string, year: number) {
    const start = new Date(Date.UTC(year, 0, 1) - BD_OFFSET_MS);
    const end = new Date(Date.UTC(year + 1, 0, 1) - BD_OFFSET_MS);

    return Member.aggregate([
      {
        $match: {
          branchId: toBranchObjectId(branchId),
          createdAt: { $gte: start, $lt: end },
        },
      },
      // Look up the member's first payment that has a packageId
      // to determine what package they originally joined with.
      {
        $lookup: {
          from: "payments",
          let: { mid: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$memberId", "$$mid"] },
                    { $ne: ["$packageId", null] },
                  ],
                },
              },
            },
            { $sort: { paymentDate: 1 } },
            { $limit: 1 },
            {
              $lookup: {
                from: "packages",
                localField: "packageId",
                foreignField: "_id",
                as: "pkgDoc",
              },
            },
            {
              $addFields: {
                resolvedTitle: {
                  $ifNull: [
                    { $arrayElemAt: ["$pkgDoc.title", 0] },
                    { $ifNull: ["$packageName", ""] },
                  ],
                },
              },
            },
          ],
          as: "firstPayment",
        },
      },
      {
        $addFields: {
          joinMonth: { $month: { $add: ["$createdAt", BD_OFFSET_MS] } },
          // Empty string = no-package member (imported, purely monthly, or "Monthly Renewal" package)
          packageTitle: {
            $let: {
              vars: {
                rawTitle: {
                  $ifNull: [
                    { $arrayElemAt: ["$firstPayment.resolvedTitle", 0] },
                    "",
                  ],
                },
              },
              in: {
                $cond: {
                  if: { $eq: ["$$rawTitle", "Monthly Renewal"] },
                  then: "",
                  else: "$$rawTitle",
                },
              },
            },
          },
        },
      },
      {
        $group: {
          _id: {
            month: "$joinMonth",
            packageTitle: "$packageTitle",
          },
          count: { $sum: 1 },
        },
      },
    ]);
  },

  getMemberPackageSummary(branchId: string) {
    return Member.aggregate([
      { $match: { branchId: toBranchObjectId(branchId), isActive: true } },
      {
        $lookup: {
          from: "packages",
          localField: "currentPackageId",
          foreignField: "_id",
          as: "pkgDoc",
        },
      },
      {
        $group: {
          _id: {
            packageId: { $ifNull: ["$currentPackageId", null] },
            packageTitle: {
              $ifNull: [{ $arrayElemAt: ["$pkgDoc.title", 0] }, ""],
            },
          },
          count: { $sum: 1 },
        },
      },
    ]);
  },

  getCompareYearTotals(branchId: string, startYear: number, endYear: number) {
    const start = new Date(Date.UTC(startYear, 0, 1) - BD_OFFSET_MS);
    const end = new Date(Date.UTC(endYear + 1, 0, 1) - BD_OFFSET_MS);

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
              year: { $year: { $add: ["$paymentDate", BD_OFFSET_MS] } },
              month: { $month: { $add: ["$paymentDate", BD_OFFSET_MS] } },
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
              year: { $year: { $add: ["$expenseDate", BD_OFFSET_MS] } },
              month: { $month: { $add: ["$expenseDate", BD_OFFSET_MS] } },
            },
            expense: { $sum: { $ifNull: ["$amount", 0] } },
          },
        },
      ]),
    ]);
  },

  getOverviewProgressYearly(branchId: string, year: number) {
    const start = new Date(Date.UTC(year, 0, 1) - BD_OFFSET_MS);
    const end = new Date(Date.UTC(year + 1, 0, 1) - BD_OFFSET_MS);

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
          _id: { month: { $month: { $add: ["$paymentDate", BD_OFFSET_MS] } } },
          value: { $sum: { $ifNull: ["$paidTotal", 0] } },
        },
      },
    ]);
  },

  getOverviewRecentTransactions(branchId: string, limit: number) {
    // Compute today's start and end in BD timezone (UTC+6)
    const now = new Date();
    const bdNow = new Date(now.getTime() + BD_OFFSET_MS);
    const todayStartUTC = new Date(
      Date.UTC(bdNow.getUTCFullYear(), bdNow.getUTCMonth(), bdNow.getUTCDate()) - BD_OFFSET_MS,
    );
    const todayEndUTC = new Date(todayStartUTC.getTime() + 24 * 60 * 60 * 1000);

    return Promise.all([
      Payment.aggregate([
        {
          $match: {
            branchId: toBranchObjectId(branchId),
            status: { $in: validIncomeStatuses },
            "metadata.entryKind": { $ne: "opening_import_balance" },
            $or: [
              { paymentDate: { $gte: todayStartUTC, $lt: todayEndUTC } },
              { createdAt: { $gte: todayStartUTC, $lt: todayEndUTC } },
            ],
          },
        },
        { $sort: { paymentDate: -1, createdAt: -1 } },
        { $limit: limit },
        {
          $lookup: {
            from: "members",
            localField: "memberId",
            foreignField: "_id",
            as: "memberDoc",
          },
        },
        {
          $addFields: {
            memberCustomId: { $arrayElemAt: ["$memberDoc.memberId", 0] },
          },
        },
        {
          $project: {
            invoiceNo: 1,
            paymentDate: 1,
            createdAt: 1,
            memberId: 1,
            memberCustomId: 1,
            memberName: 1,
            paymentType: 1,
            paymentMethod: 1,
            paidTotal: 1,
            billAmount: 1,
          },
        },
      ]),
      Expense.find({
        branchId: toBranchObjectId(branchId),
        isActive: true,
        $or: [
          { expenseDate: { $gte: todayStartUTC, $lt: todayEndUTC } },
          { createdAt: { $gte: todayStartUTC, $lt: todayEndUTC } },
        ],
      })
        .select("invoiceNo expenseDate createdAt categoryTitle paymentMethod amount description")
        .sort({ expenseDate: -1, createdAt: -1 })
        .limit(limit)
        .lean(),
    ]);
  },

  getTodayIncomeExpenseSummary(branchId: string) {
    const now = new Date();
    const bdNow = new Date(now.getTime() + BD_OFFSET_MS);
    const todayStartUTC = new Date(
      Date.UTC(bdNow.getUTCFullYear(), bdNow.getUTCMonth(), bdNow.getUTCDate()) - BD_OFFSET_MS,
    );
    const todayEndUTC = new Date(todayStartUTC.getTime() + 24 * 60 * 60 * 1000);

    return Promise.all([
      Payment.aggregate([
        {
          $match: {
            branchId: toBranchObjectId(branchId),
            status: { $in: validIncomeStatuses },
            "metadata.entryKind": { $ne: "opening_import_balance" },
            $or: [
              { paymentDate: { $gte: todayStartUTC, $lt: todayEndUTC } },
              { createdAt: { $gte: todayStartUTC, $lt: todayEndUTC } },
            ],
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: { $ifNull: ["$paidTotal", 0] } },
            count: { $sum: 1 },
          },
        },
      ]),
      Expense.aggregate([
        {
          $match: {
            branchId: toBranchObjectId(branchId),
            isActive: true,
            $or: [
              { expenseDate: { $gte: todayStartUTC, $lt: todayEndUTC } },
              { createdAt: { $gte: todayStartUTC, $lt: todayEndUTC } },
            ],
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: { $ifNull: ["$amount", 0] } },
            count: { $sum: 1 },
          },
        },
      ]),
    ]);
  },

  getAllTimeIncomeExpenseTotals(branchId: string) {
    return Promise.all([
      Payment.aggregate([
        {
          $match: {
            branchId: toBranchObjectId(branchId),
            status: { $in: validIncomeStatuses },
          },
        },
        { $group: { _id: null, total: { $sum: { $ifNull: ["$paidTotal", 0] } } } },
      ]),
      Expense.aggregate([
        {
          $match: {
            branchId: toBranchObjectId(branchId),
            isActive: true,
          },
        },
        { $group: { _id: null, total: { $sum: { $ifNull: ["$amount", 0] } } } },
      ]),
    ]);
  },
};
