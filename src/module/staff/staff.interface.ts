import { Types } from "mongoose";

export interface TStaff {
	branchId: Types.ObjectId;
	assignedBy?: Types.ObjectId;
	roleId: Types.ObjectId;
	username: string;
	displayName?: string;
	password?: string;
	email?: string;
	phone?: string;
	profilePicture?: string | null;
	lastLogin?: Date | null;
	assignedAt?: Date;
	isActive?: boolean;
	createdAt?: Date;
	updatedAt?: Date;
}

export type TPartialStaff = Partial<TStaff>;
