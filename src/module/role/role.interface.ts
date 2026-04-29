import { Types } from "mongoose";

export interface TRole {
	branchId: Types.ObjectId;
	roleName: string;
	canViewMembers?: boolean;
	canAddMember?: boolean;
	canEditMember?: boolean;
	canDeleteMember?: boolean;
	canViewPackages?: boolean;
	canAddPackage?: boolean;
	canEditPackage?: boolean;
	canDeletePackage?: boolean;
	canViewPayments?: boolean;
	canAddPayment?: boolean;
	canEditPayment?: boolean;
	canDeletePayment?: boolean;
	canRefundPayment?: boolean;
	canViewBilling?: boolean;
	canAddBilling?: boolean;
	canEditBilling?: boolean;
	canDeleteBilling?: boolean;
	canAddMonthlyFee?: boolean;
	canEditMonthlyFee?: boolean;
	canAddAdmissionFee?: boolean;
	canEditAdmissionFee?: boolean;
	canViewAnalytics?: boolean;
	canExportAnalytics?: boolean;
	canViewSMS?: boolean;
	canSendSMS?: boolean;
	canViewEmail?: boolean;
	canSendEmail?: boolean;
	canViewExpenseCategory?: boolean;
	canManageExpenseCategory?: boolean;
	canViewExpense?: boolean;
	canAddExpense?: boolean;
	createdAt?: Date;
	updatedAt?: Date;
}

export type TPartialRole = Partial<TRole>;
