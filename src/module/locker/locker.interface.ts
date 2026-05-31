import { Types } from "mongoose";

export enum LockerStatus {
  AVAILABLE = "available",
  OCCUPIED = "occupied",
  MAINTENANCE = "maintenance",
}

export interface TLocker {
  _id?: Types.ObjectId;
  branchId: Types.ObjectId;
  lockerNumber: number;
  status: LockerStatus;
  isCustomPrice: boolean;
  customPrice: number;
  assignedMemberId?: Types.ObjectId;
  assignedMemberName?: string;
  assignedAt?: Date;
  nextBillingDate?: Date;
  isDeleted: boolean;
  deletedAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export type TPartialLocker = Partial<TLocker>;
