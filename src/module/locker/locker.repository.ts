import { ClientSession, Types } from "mongoose";
import Locker from "./locker.model";
import { LockerStatus, TLocker } from "./locker.interface";

const create = async (data: Partial<TLocker>) => {
  return Locker.create(data);
};

const createMany = async (data: Partial<TLocker>[]) => {
  return Locker.insertMany(data);
};

const findById = async (id: string) => {
  return Locker.findOne({ _id: new Types.ObjectId(id), isDeleted: false });
};

const findByBranch = async (
  branchId: string,
  filters?: { status?: LockerStatus; search?: string },
) => {
  const query: Record<string, unknown> = {
    branchId: new Types.ObjectId(branchId),
    isDeleted: false,
  };

  if (filters?.status) {
    query.status = filters.status;
  }

  if (filters?.search) {
    const num = parseInt(filters.search, 10);
    if (!isNaN(num)) {
      query.lockerNumber = num;
    }
  }

  return Locker.find(query).sort({ lockerNumber: 1 }).lean();
};

const findOne = async (filter: Record<string, unknown>) => {
  return Locker.findOne(filter);
};

const updateById = async (
  id: string,
  data: Partial<TLocker>,
  session?: ClientSession | null,
) => {
  return Locker.findByIdAndUpdate(
    { _id: new Types.ObjectId(id) },
    { $set: data },
    { new: true, ...(session ? { session } : {}) },
  );
};

const countByBranch = async (branchId: string) => {
  return Locker.countDocuments({
    branchId: new Types.ObjectId(branchId),
    isDeleted: false,
  });
};

const getMaxLockerNumber = async (branchId: string) => {
  const result = await Locker.findOne(
    { branchId: new Types.ObjectId(branchId), isDeleted: false },
    { lockerNumber: 1 },
  )
    .sort({ lockerNumber: -1 })
    .lean();
  return result?.lockerNumber || 0;
};

const findByBranchAndMember = async (branchId: string, memberId: string) => {
  return Locker.findOne({
    branchId: new Types.ObjectId(branchId),
    assignedMemberId: new Types.ObjectId(memberId),
    isDeleted: false,
  }).lean();
};

const countByStatus = async (branchId: string) => {
  const result = await Locker.aggregate([
    {
      $match: {
        branchId: new Types.ObjectId(branchId),
        isDeleted: false,
      },
    },
    {
      $group: {
        _id: "$status",
        count: { $sum: 1 },
      },
    },
  ]);

  const counts: Record<string, number> = {
    total: 0,
    available: 0,
    occupied: 0,
    maintenance: 0,
  };

  for (const item of result) {
    counts[item._id] = item.count;
    counts.total += item.count;
  }

  return counts;
};

const softDelete = async (id: string) => {
  return Locker.findByIdAndUpdate(
    { _id: new Types.ObjectId(id) },
    {
      $set: {
        isDeleted: true,
        deletedAt: new Date(),
      },
    },
    { new: true },
  );
};

export const LockerRepository = {
  create,
  createMany,
  findById,
  findByBranch,
  findOne,
  updateById,
  countByBranch,
  getMaxLockerNumber,
  findByBranchAndMember,
  countByStatus,
  softDelete,
};
