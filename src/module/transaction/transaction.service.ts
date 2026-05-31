import { TransactionRepository } from "./transaction.repository";

const parseQuery = (query: Record<string, unknown>) => {
  const page = typeof query.page === "string" ? Math.max(1, Number(query.page)) : 1;
  const limit = typeof query.limit === "string" ? Math.min(100, Math.max(1, Number(query.limit))) : 20;
  const searchTerm = typeof query.searchTerm === "string" && query.searchTerm.trim()
    ? query.searchTerm.trim()
    : undefined;
  const startDate = typeof query.startDate === "string" && query.startDate
    ? query.startDate
    : undefined;
  const endDate = typeof query.endDate === "string" && query.endDate
    ? query.endDate
    : undefined;
  const type = query.type === "income" || query.type === "expense"
    ? query.type
    : undefined;
  const paymentMethod = typeof query.paymentMethod === "string" && query.paymentMethod
    ? query.paymentMethod
    : undefined;

  return { page, limit, searchTerm, startDate, endDate, type, paymentMethod };
};

const parseBalanceQuery = (query: Record<string, unknown>) => {
  const startDate = typeof query.startDate === "string" && query.startDate
    ? query.startDate
    : undefined;
  const endDate = typeof query.endDate === "string" && query.endDate
    ? query.endDate
    : undefined;
  const type = query.type === "income" || query.type === "expense"
    ? query.type
    : undefined;
  const paymentMethod = typeof query.paymentMethod === "string" && query.paymentMethod
    ? query.paymentMethod
    : undefined;

  return { startDate, endDate, type, paymentMethod };
};

const getTransactions = async (
  branchId: string,
  query: Record<string, unknown>,
) => {
  const filters = parseQuery(query);
  return TransactionRepository.getTransactions(branchId, filters);
};

const getTransactionsWithBalance = async (
  branchId: string,
  query: Record<string, unknown>,
) => {
  const filters = parseBalanceQuery(query);
  return TransactionRepository.getTransactionsWithBalance(branchId, filters);
};

export const TransactionService = {
  getTransactions,
  getTransactionsWithBalance,
};
