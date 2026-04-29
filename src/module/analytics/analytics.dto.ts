import { z } from "zod";

const paramsDto = z.object({
  branchId: z.string().trim().min(1, "branchId is required"),
});

const monthEnum = z.enum([
  "All Months",
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
]);

const analyticsFilterQueryDto = z
  .object({
    year: z.string().optional(),
    month: monthEnum.optional(),
  })
  .strict();

const compareQueryDto = z
  .object({
    metric: z.enum(["income", "expense", "netIncome"]).optional(),
    startYear: z.string().optional(),
    endYear: z.string().optional(),
  })
  .strict();

const overviewQueryDto = z
  .object({
    year: z.string().optional(),
    month: monthEnum.optional(),
    transactionLimit: z.string().optional(),
  })
  .strict();

const memberSummaryDto = z.object({
  params: paramsDto,
  query: analyticsFilterQueryDto,
});

const financialDto = z.object({
  params: paramsDto,
  query: analyticsFilterQueryDto,
});

const costDto = z.object({
  params: paramsDto,
  query: analyticsFilterQueryDto,
});

const packagesDto = z.object({
  params: paramsDto,
  query: z
    .object({
      year: z.string().optional(),
    })
    .strict(),
});

const compareDto = z.object({
  params: paramsDto,
  query: compareQueryDto,
});

const overviewDto = z.object({
  params: paramsDto,
  query: overviewQueryDto,
});

export const AnalyticsDto = {
  memberSummary: memberSummaryDto,
  financial: financialDto,
  cost: costDto,
  packages: packagesDto,
  compare: compareDto,
  overview: overviewDto,
};
