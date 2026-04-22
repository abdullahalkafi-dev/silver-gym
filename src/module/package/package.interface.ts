import { Types } from "mongoose";

export enum PackageDurationType {
	DAY = "day",
	WEEK = "week",
	MONTH = "month",
	YEAR = "year",
}

export interface TPackage {
	branchId: Types.ObjectId;
	legacyId?: string;
	title: string;
	duration: number;
	durationType: PackageDurationType;
    description?: string;
    color: string;
	amount: number;
	includeAdmissionFee?: boolean;
	admissionFeeAmount?: number;
	isActive?: boolean;
	source?: string;
	metadata?: Record<string, unknown>;
	createdAt?: Date;
	updatedAt?: Date;
}

export type TPartialPackage = Partial<TPackage>;
