import { Types } from "mongoose";

export enum PaymentType {
	PACKAGE = "package",
	MONTHLY = "monthly",
	ADMISSION = "admission",
	REGISTRATION = "registration",
	OTHER = "other",
}

export enum PaymentStatus {
	PENDING = "pending",
	PAID = "paid",
	PARTIAL = "partial",
	DUE = "due",
	CANCELLED = "cancelled",
	REFUNDED = "refunded",
}

export interface TPayment {
	branchId: Types.ObjectId;
	legacyId?: string;
	invoiceNo?: string;
	memberId?: Types.ObjectId;
	memberLegacyId?: string;
	memberName?: string;
	packageId?: Types.ObjectId;
	packageLegacyId?: string;
	packageName?: string;
	packageDuration?: number;
	packageDurationType?: string;
	paymentType?: PaymentType;
	periodStart?: Date;
	periodEnd?: Date;
	paidMonths?: number;
	year?: number;
	subTotal?: number;
	discount?: number;
	dueAmount?: number;
	paidTotal?: number;
	admissionFee?: number;
	paymentMethod?: string;
	paymentDate?: Date;
	nextPaymentDate?: Date;
	status?: PaymentStatus;
	source?: string;
	importBatchId?: string;
	metadata?: Record<string, unknown>;
	createdAt?: Date;
	updatedAt?: Date;
}

export type TPartialPayment = Partial<TPayment>;
