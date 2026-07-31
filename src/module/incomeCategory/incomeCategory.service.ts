import { StatusCodes } from "http-status-codes";
import { Types } from "mongoose";
import AppError from "../../errors/AppError";
import cacheService from "../../redis-client/cacheService";
import { BranchRepository } from "../branch/branch.repository";
import { TStaff } from "../staff/staff.interface";
import {
  TCreateIncomeCategoryPayload,
  TIncomeCategory,
  TUpdateIncomeCategoryPayload,
} from "./incomeCategory.interface";
import { IncomeCategoryRepository } from "./incomeCategory.repository";

type TAccessActor = {
  userId?: Types.ObjectId;
  staff?: TStaff;
};

const resolveBranchAccess = async (branchId: string, _actor: TAccessActor) => {
  const branch = await BranchRepository.findById(branchId);
  if (!branch) {
    throw new AppError(StatusCodes.NOT_FOUND, "Branch not found");
  }
  return branch;
};

const createCategory = async (
  branchId: string,
  actor: TAccessActor,
  payload: TCreateIncomeCategoryPayload,
) => {
  await resolveBranchAccess(branchId, actor);

  const existing = await IncomeCategoryRepository.findOne({
    branchId: new Types.ObjectId(branchId),
    title: { $regex: new RegExp(`^${payload.title.trim()}$`, "i") },
    isActive: true,
  });

  if (existing) {
    throw new AppError(
      StatusCodes.CONFLICT,
      `Income category "${payload.title}" already exists in this branch`,
    );
  }

  const categoryData: TIncomeCategory = {
    branchId: new Types.ObjectId(branchId),
    title: payload.title.trim(),
    description: payload.description?.trim(),
    color: payload.color || "#10B981",
    isActive: true,
  };

  const created = await IncomeCategoryRepository.create(categoryData);
  await cacheService.invalidateByPattern(`income-categories:${branchId}*`).catch(() => {});
  return created;
};

const getCategories = async (branchId: string, includeInactive = false) => {
  const cacheKey = `income-categories:${branchId}:${includeInactive}`;
  const cached = await cacheService.getCache<TIncomeCategory[]>(cacheKey);
  if (cached) return cached;

  const categories = await IncomeCategoryRepository.findByBranch(
    branchId,
    includeInactive,
  );
  await cacheService.setCache(cacheKey, categories, 300).catch(() => {});
  return categories;
};

const updateCategory = async (
  branchId: string,
  categoryId: string,
  actor: TAccessActor,
  payload: TUpdateIncomeCategoryPayload,
) => {
  await resolveBranchAccess(branchId, actor);

  const category = await IncomeCategoryRepository.findById(categoryId);
  if (!category) {
    throw new AppError(StatusCodes.NOT_FOUND, "Income category not found");
  }

  if (String(category.branchId) !== branchId) {
    throw new AppError(
      StatusCodes.FORBIDDEN,
      "Income category does not belong to this branch",
    );
  }

  if (payload.title && payload.title.trim() !== category.title) {
    const existing = await IncomeCategoryRepository.findOne({
      _id: { $ne: new Types.ObjectId(categoryId) },
      branchId: new Types.ObjectId(branchId),
      title: { $regex: new RegExp(`^${payload.title.trim()}$`, "i") },
      isActive: true,
    });

    if (existing) {
      throw new AppError(
        StatusCodes.CONFLICT,
        `Income category "${payload.title}" already exists in this branch`,
      );
    }
  }

  const updated = await IncomeCategoryRepository.updateById(categoryId, {
    ...(payload.title && { title: payload.title.trim() }),
    ...(payload.description !== undefined && { description: payload.description.trim() }),
    ...(payload.color && { color: payload.color }),
    ...(payload.isActive !== undefined && { isActive: payload.isActive }),
  });

  await Promise.all([
    cacheService.invalidateByPattern(`income-categories:${branchId}*`).catch(() => {}),
    cacheService.invalidateByPattern(`payments:${branchId}:*`).catch(() => {}),
    cacheService.invalidateByPattern(`analytics:${branchId}:*`).catch(() => {}),
    cacheService.invalidateByPattern(`transactions:${branchId}*`).catch(() => {}),
  ]);
  return updated;
};

const deleteCategory = async (
  branchId: string,
  categoryId: string,
  actor: TAccessActor,
) => {
  return updateCategory(branchId, categoryId, actor, { isActive: false });
};

export const IncomeCategoryService = {
  createCategory,
  getCategories,
  updateCategory,
  deleteCategory,
};
