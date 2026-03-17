import { Types } from "mongoose";

export type OTPType = "account_verification" | "password_reset" | "two_factor";
export type OTPProvider = "email" | "phone";

export interface TOTP {
  userId: Types.ObjectId;
  otp: string;
  type: OTPType;
  provider: OTPProvider;
  target: string;
  expiresAt: Date;
  attempts: number;
  maxAttempts: number;
  isUsed: boolean;
}

export type TOTPCreate = Omit<TOTP, "attempts" | "maxAttempts" | "isUsed"> & {
  attempts?: number;
  maxAttempts?: number;
  isUsed?: boolean;
};

export type createOTPData = {
  userId: Types.ObjectId;
  type: OTPType;
  provider: OTPProvider;
  target: string;
}

export type PartialTOTP = Partial<TOTP>;