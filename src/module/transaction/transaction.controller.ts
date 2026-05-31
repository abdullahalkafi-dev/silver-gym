import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";

import catchAsync from "../../shared/catchAsync";
import { TransactionService } from "./transaction.service";

const getTransactions = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;
  const result = await TransactionService.getTransactions(
    branchId,
    req.query as Record<string, unknown>,
  );

  res.status(StatusCodes.OK).json({
    success: true,
    message: "Transactions retrieved successfully",
    meta: result.meta,
    data: result.data,
  });
});

const getTransactionsWithBalance = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;
  const result = await TransactionService.getTransactionsWithBalance(
    branchId,
    req.query as Record<string, unknown>,
  );

  res.status(StatusCodes.OK).json({
    success: true,
    message: "Transactions with balance retrieved successfully",
    data: result.data,
    openingBalance: result.openingBalance,
    closingBalance: result.closingBalance,
  });
});

export const TransactionController = {
  getTransactions,
  getTransactionsWithBalance,
};
