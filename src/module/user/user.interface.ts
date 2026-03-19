export enum LoginProvider {
	EMAIL = 'email',
	PHONE = 'phone',
	GOOGLE = 'google',
}

export interface TUser {
	firstName: string;
	lastName: string;
	email?: string;
	password?: string;
	phone?: string;
	countryCode?: string; 
	isSuperAdmin?: boolean;
	loginProvider: LoginProvider;
	googleId?: string | null;
	profilePicture?: string | null;
	isEmailVerified?: boolean;
	isPhoneVerified?: boolean;
	lastLogin?: Date | null;
    status?: "active" | "inactive" | "suspended";
	createdAt?: Date;
	updatedAt?: Date;
}

export type TPartialUser = Partial<TUser>;
