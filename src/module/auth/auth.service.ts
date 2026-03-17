import bcrypt from "bcryptjs";
import { StatusCodes } from "http-status-codes";
import { Types } from "mongoose";

import config from "config";
import AppError from "errors/AppError";
import { createJwtToken } from "jwt";
import {  OTPType } from "module/otp/otp.interface";
import { OTPService } from "module/otp/otp.service";
import { LoginProvider, TUser } from "module/user/user.interface";
import { UserRepository } from "module/user/user.repository";
import { buildTokenPayload, getNormalizedIdentity, getOtpChannel } from "./auth.util";

type TLoginPayload = {
  email?: string;
  phone?: string;
  password: string;
};

type TVerifyAccountPayload = {
  email?: string;
  phone?: string;
  otp: string;
};

type TResendOtpPayload = {
  email?: string;
  phone?: string;
  type: OTPType;
};


const register = async (payload: TUser) => {
  const loginProvider = payload.loginProvider;
  const normalizedEmail = payload.email?.trim().toLowerCase();
  const normalizedPhone = payload.phone?.trim();

  if (normalizedEmail) {
    const verifiedEmailOwner = await UserRepository.findOne({
      email: normalizedEmail,
      isEmailVerified: true,
    });

    if (verifiedEmailOwner) {
      throw new AppError(
        StatusCodes.CONFLICT,
        "A verified account already uses this email",
      );
    }

    await UserRepository.deleteMany({
      email: normalizedEmail,
      isEmailVerified: false,
    });
  }

  if (normalizedPhone) {
    const verifiedPhoneOwner = await UserRepository.findOne({
      phone: normalizedPhone,
      isPhoneVerified: true,
    });

    if (verifiedPhoneOwner) {
      throw new AppError(
        StatusCodes.CONFLICT,
        "A verified account already uses this phone number",
      );
    }

    await UserRepository.deleteMany({
      phone: normalizedPhone,
      isPhoneVerified: false,
    });
  }

  const userPayload: TUser = {
    ...payload,
    email: normalizedEmail,
    phone: normalizedPhone,
    isEmailVerified: loginProvider === LoginProvider.GOOGLE,
    isPhoneVerified: false,
  };

  const user = await UserRepository.create(userPayload);

  if (!user.isEmailVerified && !user.isPhoneVerified) {
    const otpChannel = getOtpChannel(user);

    if (!otpChannel) {
      throw new AppError(
        StatusCodes.BAD_REQUEST,
        "No valid email or phone found for OTP delivery",
      );
    }

    await OTPService.createOTP({
      userId: user._id as Types.ObjectId,
      name: `${user.firstName} ${user.lastName}`,
      type: "account_verification",
      provider: otpChannel.provider,
      target: otpChannel.target,
    });
  }

  return user;
};

const login = async (payload: TLoginPayload) => {
  const { email, phone } = getNormalizedIdentity(payload);

  const user = await UserRepository.findOne(
    {
      ...(email ? { email } : { phone }),
    },
    { select: "+password" },
  );

  if (!user) {
    throw new AppError(StatusCodes.UNAUTHORIZED, "Invalid credentials");
  }

  if (user.status !== "active") {
    throw new AppError(
      StatusCodes.UNAUTHORIZED,
      "You account does not exist or is not active",
    );
  }

  const userWithPassword = user as typeof user & { password?: string };
  const hashedPassword = userWithPassword.password;

  if (!hashedPassword) {
    throw new AppError(
      StatusCodes.UNAUTHORIZED,
      "Password login is not available for this account",
    );
  }

  const isPasswordMatched = await bcrypt.compare(payload.password, hashedPassword);

  if (!isPasswordMatched) {
    throw new AppError(StatusCodes.UNAUTHORIZED, "Invalid credentials");
  }

  if (email && !user.isEmailVerified) {
    throw new AppError(
      StatusCodes.UNAUTHORIZED,
      "Please verify your account before login",
    );
  }

  if (phone && !user.isPhoneVerified) {
    throw new AppError(
      StatusCodes.UNAUTHORIZED,
      "Please verify your account before login",
    );
  }

  const tokenPayload = buildTokenPayload(user);

  const accessToken = createJwtToken(
    tokenPayload,
    config.jwt.jwt_secret as string,
    config.jwt.jwt_expire_in || "7d",
  );

  const refreshToken = createJwtToken(
    tokenPayload,
    (config.jwt.jwt_refresh_secret || config.jwt.jwt_secret) as string,
    config.jwt.jwt_refresh_expire_in || "30d",
  );

  await UserRepository.updateById(String(user._id), { lastLogin: new Date() });

  const userObject = user.toObject() as ReturnType<typeof user.toObject> & {
    password?: string;
  };
  const { password: _password, ...sanitizedUser } = userObject;

  return {
    accessToken,
    refreshToken,
    user: sanitizedUser,
  };
};

const verifyAccount = async (payload: TVerifyAccountPayload) => {
  const { email, phone } = getNormalizedIdentity(payload);

  const user = await UserRepository.findOne({
    ...(email ? { email } : { phone }),
  });

  if (!user) {
    throw new AppError(StatusCodes.NOT_FOUND, "User not found");
  }

  if (email && user.isEmailVerified) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Email already verified");
  }

  if (phone && user.isPhoneVerified) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Phone already verified");
  }

  await OTPService.verifyOTP(
    user._id as Types.ObjectId,
    "account_verification",
    payload.otp,
  );

  const updatedUser = await UserRepository.updateById(String(user._id), {
    ...(email ? { isEmailVerified: true } : {}),
    ...(phone ? { isPhoneVerified: true } : {}),
  });

  if (!updatedUser) {
    throw new AppError(StatusCodes.NOT_FOUND, "User not found");
  }

  return updatedUser;
};

const resendOtp = async (payload: TResendOtpPayload) => {
  const { email, phone } = getNormalizedIdentity(payload);

  const user = await UserRepository.findOne({
    ...(email ? { email } : { phone }),
  });

  if (!user) {
    throw new AppError(StatusCodes.NOT_FOUND, "User not found");
  }

  if (payload.type === "account_verification") {
    if (email && user.isEmailVerified) {
      throw new AppError(StatusCodes.BAD_REQUEST, "Email already verified");
    }

    if (phone && user.isPhoneVerified) {
      throw new AppError(StatusCodes.BAD_REQUEST, "Phone already verified");
    }
  }

  const otpChannel = getOtpChannel(user);

  if (!otpChannel) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "No valid email or phone found for OTP delivery",
    );
  }

  await OTPService.createOTP({
    userId: user._id as Types.ObjectId,
    name: `${user.firstName} ${user.lastName}`,
    type: payload.type,
    provider: otpChannel.provider,
    target: otpChannel.target,
  });

  return {
    target: otpChannel.target,
    provider: otpChannel.provider,
    type: payload.type,
  };
};

export const AuthService = {
  register,
  login,
  verifyAccount,
  resendOtp,
};
