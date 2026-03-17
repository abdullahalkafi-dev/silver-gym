import { Schema, model } from "mongoose";

import { LoginProvider, TUser } from "./user.interface";
import generateHashPassword from "util/generateHashPassword";

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
  { _id: false },
);

const userSchema = new Schema<TUser>(
  {
    firstName: {
      type: String,
      required: true,
      trim: true,
    },
    lastName: {
      type: String,
      required: true,
      trim: true,
    },

    email: {
      type: String,
      lowercase: true,
      trim: true,
      sparse: true,
    },
    password: {
      type: String,
      select: false,
    },
    phone: {
      type: String,
      trim: true,
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
  },
);

userSchema.index(
  { email: 1, isEmailVerified: 1 },
  {
    unique: true,
    partialFilterExpression: {
      email: { $exists: true, $type: "string" },
      isEmailVerified: true,
    },
  },
);

userSchema.index(
  { phone: 1, isPhoneVerified: 1 },
  {
    unique: true,
    partialFilterExpression: {
      phone: { $exists: true, $type: "string" },
      isPhoneVerified: true,
    },
  },
);
userSchema.pre("save",async function (_next) {
  if (this.isModified("password") && this.password) {
    this.password = generateHashPassword(this.password);
  }
});

userSchema.index(
  { email: 1 },
  {
    partialFilterExpression: {
      email: { $exists: true, $type: "string" },
    },
  },
);

userSchema.index(
  { phone: 1 },
  {
    partialFilterExpression: {
      phone: { $exists: true, $type: "string" },
    },
  },
);


export const User = model<TUser>("User", userSchema);
