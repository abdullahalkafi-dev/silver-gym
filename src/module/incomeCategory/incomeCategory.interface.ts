import { Types } from "mongoose";

export interface TIncomeCategory {
  _id?: Types.ObjectId;
  branchId: Types.ObjectId;
  title: string;
  description?: string;
  color?: string;
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export type TCreateIncomeCategoryPayload = {
  title: string;
  description?: string;
  color?: string;
};

export type TUpdateIncomeCategoryPayload = Partial<TCreateIncomeCategoryPayload> & {
  isActive?: boolean;
};
