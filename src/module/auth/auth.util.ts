import { OTPProvider } from "module/otp/otp.interface";
import { LoginProvider } from "module/user/user.interface";
import { Types } from "mongoose";

export const getNormalizedIdentity = (payload: { email?: string; phone?: string }) => {
  return {
    email: payload.email?.trim().toLowerCase(),
    phone: payload.phone?.trim(),
  };
};

export const getOtpChannel = (user: {
  email?: string;
  phone?: string;
  isEmailVerified?: boolean;
  isPhoneVerified?: boolean;
}) => {
  if (user.email && !user.isEmailVerified) {
    return { provider: "email" as OTPProvider, target: user.email };
  }

  if (user.phone && !user.isPhoneVerified) {
    return { provider: "phone" as OTPProvider, target: user.phone };
  }

  if (user.email) {
    return { provider: "email" as OTPProvider, target: user.email };
  }

  if (user.phone) {
    return { provider: "phone" as OTPProvider, target: user.phone };
  }

  return null;
};

export const buildTokenPayload = (user: {
  _id: string | Types.ObjectId;
  email?: string;
  phone?: string;
  isSuperAdmin?: boolean;
  loginProvider?: LoginProvider;
}) => ({
  _id: String(user._id),
  email: user.email,
  phone: user.phone,
  isSuperAdmin: Boolean(user.isSuperAdmin),
  loginProvider: user.loginProvider,
});
