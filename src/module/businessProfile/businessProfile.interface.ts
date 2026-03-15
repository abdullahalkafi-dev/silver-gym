import { Types } from "mongoose";

export enum BusinessType {
	GYM = "gym",
	FITNESS = "fitness",
	STUDIO = "studio",
	OTHER = "other",
}

export interface TBusinessProfile {
	userId: Types.ObjectId;
	logo?: string | null;
	businessName: string;
	businessType: BusinessType;
	registrationNumber?: string;
	country?: string;
	city?: string;
	zip?: string;
	businessAddress?: string;
	businessPhoneNumber?: string;
	businessEmail?: string;
	createdAt?: Date;
	updatedAt?: Date;
}

export type TPartialBusinessProfile = Partial<TBusinessProfile>;
