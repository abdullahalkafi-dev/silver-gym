import { normalizeMoney } from "./payment.balance";

export type TCollectBillResolutionSummaryLine = {
  kind: "selected_due" | "cycle";
  lineType: string;
  label: string;
  amount: number;
  discountAppliedAmount: number;
  paidAppliedAmount: number;
};

export type TCollectBillResolutionSummary = {
  waivedDueAmount: number;
  waivedDueItemCount: number;
  waivedDueLabels: string[];
  paidDueAmount: number;
  paidDueItemCount: number;
  discountedCycleAmount: number;
  paidCycleAmount: number;
  cycleChargeAmount: number;
};

export const summarizeCollectBillResolution = (
  lines: TCollectBillResolutionSummaryLine[],
): TCollectBillResolutionSummary => {
  const dueLines = lines.filter((line) => line.kind === "selected_due");
  const cycleLines = lines.filter((line) => line.kind === "cycle");
  const waivedDueLines = dueLines.filter(
    (line) => normalizeMoney(line.discountAppliedAmount) > 0,
  );
  const paidDueLines = dueLines.filter(
    (line) => normalizeMoney(line.paidAppliedAmount) > 0,
  );

  return {
    waivedDueAmount: normalizeMoney(
      waivedDueLines.reduce(
        (total, line) => total + normalizeMoney(line.discountAppliedAmount),
        0,
      ),
    ),
    waivedDueItemCount: waivedDueLines.length,
    waivedDueLabels: waivedDueLines.map((line) => line.label),
    paidDueAmount: normalizeMoney(
      paidDueLines.reduce(
        (total, line) => total + normalizeMoney(line.paidAppliedAmount),
        0,
      ),
    ),
    paidDueItemCount: paidDueLines.length,
    discountedCycleAmount: normalizeMoney(
      cycleLines.reduce(
        (total, line) => total + normalizeMoney(line.discountAppliedAmount),
        0,
      ),
    ),
    paidCycleAmount: normalizeMoney(
      cycleLines.reduce(
        (total, line) => total + normalizeMoney(line.paidAppliedAmount),
        0,
      ),
    ),
    cycleChargeAmount: normalizeMoney(
      cycleLines.reduce((total, line) => total + normalizeMoney(line.amount), 0),
    ),
  };
};