import { Types } from "mongoose";

export type TBranchSMSAutoToggles = {
	dueReminder: boolean;
	birthday: boolean;
	paymentConfirmation: boolean;
	membershipExpired: boolean;
	welcome: boolean;
};

export const DEFAULT_BRANCH_SMS_TOGGLES: TBranchSMSAutoToggles = {
	dueReminder: false,
	birthday: false,
	paymentConfirmation: false,
	membershipExpired: false,
	welcome: false,
};

export interface TBranchSMSSettings {
	/** Master switch. OFF by default for every branch. */
	enabled: boolean;
	maskingSender?: string | null;
	reminderDayOfMonth: number;
	/** Dhaka-time hour (9-20) when the due-reminder / birthday jobs start sending. */
	reminderHour: number;
	birthdayHour: number;
	toggles: TBranchSMSAutoToggles;
	updatedAt?: Date | null;
	updatedBy?: Types.ObjectId | null;
	lastAutoReminderRunDate?: string | null;
	lastBirthdayRunDate?: string | null;
}

export interface TBranchAccessControl {
	enabled: boolean;
	graceDays: number;
	debounceMinutes: number;
	updatedAt?: Date | null;
	updatedBy?: Types.ObjectId | null;
}

export const getDefaultBranchAccessControl = (): TBranchAccessControl => ({
	enabled: false,
	graceDays: 5,
	debounceMinutes: 5,
	updatedAt: null,
	updatedBy: null,
});

export const DEFAULT_BRANCH_AUTO_DEACTIVATE_AFTER_UNPAID_MONTHS = 6;

export const normalizeBranchAutoDeactivateAfterUnpaidMonths = (
	value?: number | null,
): number => {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
		return DEFAULT_BRANCH_AUTO_DEACTIVATE_AFTER_UNPAID_MONTHS;
	}

	return Math.floor(value);
};

export const getDefaultBranchSMSSettings = (): TBranchSMSSettings => ({
	enabled: false,
	maskingSender: null,
	reminderDayOfMonth: 5,
	reminderHour: 10,
	birthdayHour: 10,
	toggles: { ...DEFAULT_BRANCH_SMS_TOGGLES },
	lastAutoReminderRunDate: null,
	lastBirthdayRunDate: null,
	updatedAt: null,
	updatedBy: null,
});

export const normalizeBranchSMSSettings = (
	settings?: Partial<TBranchSMSSettings> | null,
): TBranchSMSSettings => {
	const raw: Partial<TBranchSMSSettings> =
		settings && typeof (settings as any).toObject === "function"
			? (settings as any).toObject()
			: settings ?? {};
	const defaults = getDefaultBranchSMSSettings();
	const clampInt = (value: unknown, min: number, max: number, fallback: number) => {
		const n = Number(value);
		return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
	};

	return {
		enabled: raw.enabled === true,
		maskingSender:
			typeof raw.maskingSender === "string" ? raw.maskingSender.trim() || null : null,
		reminderDayOfMonth: clampInt(raw.reminderDayOfMonth, 1, 31, defaults.reminderDayOfMonth),
		reminderHour: clampInt(raw.reminderHour, 9, 20, defaults.reminderHour),
		birthdayHour: clampInt(raw.birthdayHour, 9, 20, defaults.birthdayHour),
		toggles: {
			dueReminder: raw.toggles?.dueReminder === true,
			birthday: raw.toggles?.birthday === true,
			paymentConfirmation: raw.toggles?.paymentConfirmation === true,
			membershipExpired: raw.toggles?.membershipExpired === true,
			welcome: raw.toggles?.welcome === true,
		},
		lastAutoReminderRunDate: raw.lastAutoReminderRunDate ?? null,
		lastBirthdayRunDate: raw.lastBirthdayRunDate ?? null,
		updatedAt: raw.updatedAt ?? null,
		updatedBy: raw.updatedBy ?? null,
	};
};

export interface TBranch {
	businessId: Types.ObjectId;
	branchName: string;
	branchAddress?: string;
	monthlyFeeAmount?: number;
	admissionFeeAmount?: number;
	lockerFeeAmount?: number;
	autoDeactivateAfterUnpaidMonths?: number;
	/** When true, member imports may contain duplicate phone numbers. Add/edit stay strictly unique. */
	allowDuplicatePhoneOnImport?: boolean;
	lastAutoDeactivationRunDate?: string | null;
	lastDueAccrualRunDate?: string | null;
	startingBalance?: number | null;
	startingBalanceSetAt?: Date | null;
	smsSettings?: TBranchSMSSettings;
	accessControl?: TBranchAccessControl;
	logo?: string | null;
	favicon?: string | null;
	isDefault?: boolean;
	isActive?: boolean;
	createdAt?: Date;
	updatedAt?: Date;
}

export type TPartialBranch = Partial<TBranch>;
