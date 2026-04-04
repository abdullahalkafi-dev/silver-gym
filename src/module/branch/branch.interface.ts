import { Types } from "mongoose";

export interface TBranch {
	businessId: Types.ObjectId;
	branchName: string;
	branchAddress?: string;
	monthlyFeeAmount?: number;
	logo?: string | null;
	favicon?: string | null;
	isDefault?: boolean;
	isActive?: boolean;
	createdAt?: Date;
	updatedAt?: Date;
}

export type TPartialBranch = Partial<TBranch>;
