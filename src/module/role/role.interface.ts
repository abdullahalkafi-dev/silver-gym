import { Types } from "mongoose";

export interface TRole {
	branchId: Types.ObjectId;
	roleName: string;
	canManageMembers?: boolean;
	canManagePackages?: boolean;
	canManagePayments?: boolean;
	canManageBilling?: boolean;
	canManageExpenses?: boolean;
	canManageLockers?: boolean;
	createdAt?: Date;
	updatedAt?: Date;
}

export type TPartialRole = Partial<TRole>;
