import { Schema, model } from "mongoose";

import { LoginProvider, TUser } from "./user.interface";

const linkedProviderSchema = new Schema(
	{
		provider: {
			type: String,
			enum: Object.values(LoginProvider),
			required: true,
		},
		providerId: {
			type: String,
			required: true,
		},
		linkedAt: {
			type: Date,
		},
	},
	{ _id: false }
);

const userSchema = new Schema<TUser>(
	{
		name: {
			type: String,
			required: true,
			trim: true,
		},
		email: {
			type: String,
			lowercase: true,
			trim: true,
			unique: true,
			sparse: true,
		},
		password: {
			type: String,
			select: false,
		},
		phone: {
			type: String,
			trim: true,
			unique: true,
			sparse: true,
		},
		countryCode: {
			type: String,
			trim: true,
		},
		isSuperAdmin: {
			type: Boolean,
			default: false,
		},
		loginProvider: {
			type: String,
			enum: Object.values(LoginProvider),
			required: true,
			default: LoginProvider.EMAIL,
		},
		googleId: {
			type: String,
			unique: true,
			sparse: true,
		},
		profilePicture: {
			type: String,
		},
		isEmailVerified: {
			type: Boolean,
			default: false,
		},
		isPhoneVerified: {
			type: Boolean,
			default: false,
		},
		lastLogin: {
			type: Date,
		},
		linkedProviders: {
			type: [linkedProviderSchema],
			default: [],
		},
        status: {
            type: String,
            enum: ["active", "inactive", "suspended"],
            default: "active",
        },
	},
	{
		timestamps: true,
	}
);

export const User = model<TUser>("User", userSchema);

