import { Types } from "mongoose";
import { IncomeCategory } from "./incomeCategory.model";
import { TIncomeCategory } from "./incomeCategory.interface";

const create = async (payload: TIncomeCategory) => {
  return IncomeCategory.create(payload);
};

const findById = async (id: string) => {
  return IncomeCategory.findById(id);
};

const findByBranch = async (branchId: string, includeInactive = false) => {
  const filter: Record<string, unknown> = {
    branchId: new Types.ObjectId(branchId),
  };

  if (!includeInactive) {
    filter.isActive = true;
  }

  return IncomeCategory.find(filter).sort({ title: 1 }).lean();
};

const updateById = async (id: string, payload: Partial<TIncomeCategory>) => {
  return IncomeCategory.findByIdAndUpdate(id, payload, { new: true });
};

const findOne = async (filter: Record<string, unknown>) => {
  return IncomeCategory.findOne(filter);
};

export const IncomeCategoryRepository = {
  create,
  findById,
  findByBranch,
  updateById,
  findOne,
};
