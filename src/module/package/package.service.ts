import { StatusCodes } from "http-status-codes";
import { Types } from "mongoose";

import { QueryBuilder } from "../../Builder/QueryBuilder";
import AppError from "../../errors/AppError";
import { BranchService } from "../branch/branch.service";
import { BranchRepository } from "../branch/branch.repository";
import { BusinessProfileRepository } from "../businessProfile/businessProfile.repository";
import { TStaff } from "../staff/staff.interface";
import { TPackage } from "./package.interface";
import { PackageRepository } from "./package.repository";

type TAccessActor = {
  userId?: Types.ObjectId;
  staff?: TStaff;
};

type TCreatePackagePayload = Omit<TPackage, "branchId" | "createdAt" | "updatedAt">;

type TUpdatePackagePayload = Partial<
  Omit<TPackage, "branchId" | "legacyId" | "createdAt" | "updatedAt">
>;

type TQueryPackage = {
  searchTerm?: string;
  legacyId?: string;
  durationType?: string;
  isActive?: string;
  minAmount?: string;
  maxAmount?: string;
  includeAdmissionFee?: string;
  sort?: string;
  page?: string;
  limit?: string;
  fields?: string;
};

const resolveBranchAccess = async (branchId: string, actor: TAccessActor) => {
  const branch = await BranchRepository.findOne({
    _id: new Types.ObjectId(branchId),
    isActive: true,
  });

  if (!branch) {
    throw new AppError(StatusCodes.NOT_FOUND, "Branch not found");
  }

  if (actor.userId) {
    const business = await BusinessProfileRepository.findOne({
      _id: branch.businessId,
      userId: actor.userId,
    });

    if (!business) {
      throw new AppError(
        StatusCodes.FORBIDDEN,
        "You do not have permission to access this branch",
      );
    }

    return branch;
  }

  if (actor.staff) {
    if (!actor.staff.isActive) {
      throw new AppError(StatusCodes.FORBIDDEN, "Staff account is inactive");
    }

    if (String(actor.staff.branchId) !== String(branch._id)) {
      throw new AppError(
        StatusCodes.FORBIDDEN,
        "You do not have permission to access this branch",
      );
    }

    return branch;
  }

  throw new AppError(StatusCodes.UNAUTHORIZED, "You are not authorized");
};

const createPackage = async (
  branchId: string,
  actor: TAccessActor,
  payload: TCreatePackagePayload,
) => {
  const branch = await resolveBranchAccess(branchId, actor);
  BranchService.ensureBranchFeesConfigured(branch, "package");

  // Check for duplicate package title in the same branch
  const existingPackage = await PackageRepository.findOne({
    branchId: new Types.ObjectId(branchId),
    title: payload.title,
    isActive: true,
  });

  if (existingPackage) {
    throw new AppError(
      StatusCodes.CONFLICT,
      "A package with this title already exists in this branch",
    );
  }

  const {
    admissionFeeAmount: _ignoredAdmissionFeeAmount,
    includeAdmissionFee,
    ...restPayload
  } = payload;

  const packageData: TPackage = {
    ...restPayload,
    branchId: new Types.ObjectId(branchId),
    includeAdmissionFee: Boolean(includeAdmissionFee),
    isActive: payload.isActive ?? true,
    source: payload.source || "MANUAL",
  };

  const newPackage = await PackageRepository.create(packageData);

  return newPackage;
};

const getAllPackages = async (
  branchId: string,
  actor: TAccessActor,
  query: TQueryPackage,
) => {
  await resolveBranchAccess(branchId, actor);

  const packageQuery = new QueryBuilder(
    PackageRepository.findMany({ branchId: new Types.ObjectId(branchId) }),
    query,
  )
    .search(["title", "description"])
    .filter()
    .sort()
    .paginate()
    .fields();

  const result = await packageQuery.modelQuery;
  const meta = await packageQuery.countTotal();

  return {
    meta,
    result,
  };
};

const getPackageById = async (
  branchId: string,
  packageId: string,
  actor: TAccessActor,
) => {
  await resolveBranchAccess(branchId, actor);

  const packageDoc = await PackageRepository.findOne({
    _id: new Types.ObjectId(packageId),
    branchId: new Types.ObjectId(branchId),
  });

  if (!packageDoc) {
    throw new AppError(StatusCodes.NOT_FOUND, "Package not found");
  }

  return packageDoc;
};

const updatePackage = async (
  branchId: string,
  packageId: string,
  actor: TAccessActor,
  payload: TUpdatePackagePayload,
) => {
  await resolveBranchAccess(branchId, actor);

  const existingPackage = await PackageRepository.findOne({
    _id: new Types.ObjectId(packageId),
    branchId: new Types.ObjectId(branchId),
  });

  if (!existingPackage) {
    throw new AppError(StatusCodes.NOT_FOUND, "Package not found");
  }

  // Check for duplicate title if title is being updated
  if (payload.title && payload.title !== existingPackage.title) {
    const duplicatePackage = await PackageRepository.findOne({
      branchId: new Types.ObjectId(branchId),
      title: payload.title,
      isActive: true,
      _id: { $ne: new Types.ObjectId(packageId) },
    });

    if (duplicatePackage) {
      throw new AppError(
        StatusCodes.CONFLICT,
        "A package with this title already exists in this branch",
      );
    }
  }

  const { admissionFeeAmount: _ignoredAdmissionFeeAmount, ...restPayload } = payload;

  const updateOperation = {
    ...(Object.keys(restPayload).length ? { $set: restPayload } : {}),
    $unset: { admissionFeeAmount: 1 },
  };

  const updatedPackage = await PackageRepository.updateById(packageId, updateOperation);

  if (!updatedPackage) {
    throw new AppError(StatusCodes.INTERNAL_SERVER_ERROR, "Failed to update package");
  }

  return updatedPackage;
};

const deletePackage = async (
  branchId: string,
  packageId: string,
  actor: TAccessActor,
) => {
  await resolveBranchAccess(branchId, actor);

  const existingPackage = await PackageRepository.findOne({
    _id: new Types.ObjectId(packageId),
    branchId: new Types.ObjectId(branchId),
  });

  if (!existingPackage) {
    throw new AppError(StatusCodes.NOT_FOUND, "Package not found");
  }

  // Soft delete by setting isActive to false
  const deletedPackage = await PackageRepository.updateById(packageId, {
    isActive: false,
  });

  return deletedPackage;
};

const restorePackage = async (
  branchId: string,
  packageId: string,
  actor: TAccessActor,
) => {
  await resolveBranchAccess(branchId, actor);

  const existingPackage = await PackageRepository.findOne({
    _id: new Types.ObjectId(packageId),
    branchId: new Types.ObjectId(branchId),
  });

  if (!existingPackage) {
    throw new AppError(StatusCodes.NOT_FOUND, "Package not found");
  }

  const restoredPackage = await PackageRepository.updateById(packageId, {
    isActive: true,
  });

  return restoredPackage;
};

export const PackageService = {
  createPackage,
  getAllPackages,
  getPackageById,
  updatePackage,
  deletePackage,
  restorePackage,
};
