export enum LoginProvider {
	EMAIL = 'email',
	PHONE = 'phone',
	GOOGLE = 'google',
}

export interface LinkedProvider {
	provider: LoginProvider;
	providerId: string;
	linkedAt?: Date;
}

export interface TUser {
	name: string;
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
	linkedProviders?: LinkedProvider[];
    status?: "active" | "inactive" | "suspended";
	createdAt?: Date;
	updatedAt?: Date;
}

export type TPartialUser = Partial<TUser>;
