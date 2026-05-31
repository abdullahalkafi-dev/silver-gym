export type TTransactionType = "income" | "expense";

export type TTransactionQuery = {
  branchId: string;
  searchTerm?: string;
  startDate?: string;
  endDate?: string;
  type?: TTransactionType;
  paymentMethod?: string;
  page?: number;
  limit?: number;
};

export type TTransactionItem = {
  id: string;
  invoiceNo: string;
  date: string;
  dateISO: string;
  type: TTransactionType;
  category: string;
  description: string;
  memberId: string | null;
  memberCustomId: string | null;
  paymentMethod: string;
  amount: number;
};

export type TTransactionMeta = {
  page: number;
  limit: number;
  total: number;
  totalPage: number;
};
