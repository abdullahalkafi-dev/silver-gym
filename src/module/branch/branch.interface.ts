import { Types } from "mongoose";
import type { TSmsDeliveryMode } from "../sms/sms.interface";

export interface TBranchSMSSettings {
	autoSendEnabled: boolean;
	reminderDayOfMonth: number;
	template: string;
	templateBangla: string;
	occasionTemplate: string;
	occasionTemplateBangla: string;
	promotionTemplate: string;
	promotionTemplateBangla: string;
	defaultDeliveryMode: TSmsDeliveryMode;
	maskingSender?: string | null;
	updatedAt?: Date | null;
	updatedBy?: Types.ObjectId | null;
	lastAutoReminderRunDate?: string | null;
}

export const DEFAULT_BRANCH_AUTO_DEACTIVATE_AFTER_UNPAID_MONTHS = 6;

export const normalizeBranchAutoDeactivateAfterUnpaidMonths = (
	value?: number | null,
): number => {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
		return DEFAULT_BRANCH_AUTO_DEACTIVATE_AFTER_UNPAID_MONTHS;
	}

	return Math.floor(value);
};

export const DEFAULT_BRANCH_SMS_TEMPLATE =
	"Dear {memberName}, your {dueMonth} monthly due is pending at {branchName}. Please pay as soon as possible. Thank you. Contact: 01815635091";

export const DEFAULT_BRANCH_SMS_TEMPLATE_BANGLA =
	"প্রিয় {memberName}, {branchName} এ {dueMonth} মাসিক বকেয়া বাকি আছে। দয়া করে যত দ্রুত সম্ভব পরিশোধ করুন। ধন্যবাদ। যোগাযোগ: 01815635091";

export const DEFAULT_BRANCH_SMS_OCCASION_TEMPLATE =
	"Dear {memberName}, greetings from {branchName}. Thank you for being with us.";

export const DEFAULT_BRANCH_SMS_OCCASION_TEMPLATE_BANGLA =
	"প্রিয় {memberName}, {branchName} থেকে আপনাকে শুভেচ্ছা জানাচ্ছি। আমাদের পাশে থাকার জন্য ধন্যবাদ।";

export const DEFAULT_BRANCH_SMS_PROMOTION_TEMPLATE =
	"Dear {memberName}, {branchName} has a new offer for you. Contact us for details.";

export const DEFAULT_BRANCH_SMS_PROMOTION_TEMPLATE_BANGLA =
	"প্রিয় {memberName}, {branchName} আপনার জন্য একটি নতুন অফার রেখেছে। বিস্তারিত জানতে আমাদের সাথে যোগাযোগ করুন।";

export const getDefaultBranchSMSSettings = (): TBranchSMSSettings => ({
	autoSendEnabled: false,
	reminderDayOfMonth: 5,
	template: DEFAULT_BRANCH_SMS_TEMPLATE,
	templateBangla: DEFAULT_BRANCH_SMS_TEMPLATE_BANGLA,
	occasionTemplate: DEFAULT_BRANCH_SMS_OCCASION_TEMPLATE,
	occasionTemplateBangla: DEFAULT_BRANCH_SMS_OCCASION_TEMPLATE_BANGLA,
	promotionTemplate: DEFAULT_BRANCH_SMS_PROMOTION_TEMPLATE,
	promotionTemplateBangla: DEFAULT_BRANCH_SMS_PROMOTION_TEMPLATE_BANGLA,
	defaultDeliveryMode: "masking",
	maskingSender: null,
	updatedAt: null,
	updatedBy: null,
	lastAutoReminderRunDate: null,
});

export const normalizeBranchSMSSettings = (
	settings?: Partial<TBranchSMSSettings> | null,
): TBranchSMSSettings => ({
	...getDefaultBranchSMSSettings(),
	...(settings ?? {}),
	defaultDeliveryMode: "masking",
	maskingSender:
		typeof settings?.maskingSender === "string"
			? settings.maskingSender.trim() || null
			: settings?.maskingSender ?? null,
});

export interface TBranch {
	businessId: Types.ObjectId;
	branchName: string;
	branchAddress?: string;
	monthlyFeeAmount?: number;
	admissionFeeAmount?: number;
	lockerFeeAmount?: number;
	autoDeactivateAfterUnpaidMonths?: number;
	lastAutoDeactivationRunDate?: string | null;
	lastDueAccrualRunDate?: string | null;
	startingBalance?: number | null;
	startingBalanceSetAt?: Date | null;
	smsSettings?: TBranchSMSSettings;
	logo?: string | null;
	favicon?: string | null;
	isDefault?: boolean;
	isActive?: boolean;
	createdAt?: Date;
	updatedAt?: Date;
}

export type TPartialBranch = Partial<TBranch>;
