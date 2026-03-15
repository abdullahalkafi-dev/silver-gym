import { Types } from "mongoose";

export interface emergencyContact{
    name: string;
    relationship: string;
    contactNumber: string;
}

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
	heightUnit?: string;
	weight?: number;
	weightUnit?: string;
	address?: string;
	photo?: string;
	emergencyContact?: emergencyContact;
	trainingGoals?: string;
	currentPackageId?: Types.ObjectId;
	currentPackageName?: string;
	membershipStartDate?: Date;
	membershipEndDate?: Date;
	nextPaymentDate?: Date;
	isActive?: boolean;
	customMonthlyFee?: boolean;
	monthlyFeeAmount?: number;
	paidMonths?: number;
	source?: string;
	importBatchId?: string;
	metadata?: Record<string, unknown>;
	createdAt?: Date;
	updatedAt?: Date;
}

export type TPartialMember = Partial<TMember>;
