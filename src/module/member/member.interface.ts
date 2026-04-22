import { Types } from "mongoose";

export interface emergencyContact{
    relationship: string;
    contactNumber: string;
}
export type heightUnit = "cm" | "in" | "ft";
export type weightUnit = "kg" | "lb";
export type trainingGoal =
	| "Yoga"
	| "Cardio Endurance"
	| "Bodybuilding"
	| "Muscle Gain"
	| "Flexibility & Mobility"
	| "General Fitness"
	| "Strength Training";
export interface TMember {
	branchId: Types.ObjectId;
	legacyId?: string;
	memberId?: string;
	barcode?: string;
	fullName: string;
	contact?: string;
	email?: string;
	dateOfBirth?: Date;
	country?: string;
	nid?: string;
	gender?: string;
	bloodGroup?: string;
	height?: number;
	heightUnit?: heightUnit;
	weight?: number;
	weightUnit?: weightUnit;
	address?: string;
	photo?: string;
	emergencyContact?: emergencyContact;
	trainingGoals?: trainingGoal[];
	currentPackageId?: Types.ObjectId;
	currentPackageName?: string;
	membershipStartDate?: Date;
	membershipEndDate?: Date;
	nextPaymentDate?: Date;
	isActive?: boolean;
	isCustomMonthlyFee?: boolean;
	customMonthlyFeeAmount?: number;
	paidMonths?: number;
	currentDueAmount?: number;
	currentAdvanceAmount?: number;
	source?: string;
	importBatchId?: string;
	metadata?: Record<string, unknown>;
	createdAt?: Date;
	updatedAt?: Date;
}

export type TPartialMember = Partial<TMember>;
