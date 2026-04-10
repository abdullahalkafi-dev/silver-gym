import bcrypt from "bcryptjs";
import { StatusCodes } from "http-status-codes";
import { Types } from "mongoose";

import config from "config";
import AppError from "errors/AppError";
import { createJwtToken, verifyJwtToken } from "jwt";
import {  OTPType } from "module/otp/otp.interface";
import { OTPService } from "module/otp/otp.service";
import { TRole } from "module/role/role.interface";
import { StaffRepository } from "module/staff/staff.repository";
import { LoginProvider, TUser } from "module/user/user.interface";
import { UserRepository } from "module/user/user.repository";
import { BusinessProfileRepository } from "module/businessProfile/businessProfile.repository";
import {
  buildStaffTokenPayload,
  buildTokenPayload,
  getNormalizedIdentity,
  getOtpChannel,
} from "./auth.util";
import generateHashPassword from "util/generateHashPassword";

type TLoginPayload = {
  email?: string;
  phone?: string;
  password: string;
};

type TStaffLoginPayload = {
  username: string;
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

type TForgotPasswordPayload = {
  email?: string;
  phone?: string;
};

type TVerifyResetOtpPayload = {
  email?: string;
  phone?: string;
  otp: string;
};

type TResetPasswordPayload = {
  resetToken: string;
  newPassword: string;
};

type TChangePasswordPayload = {
  oldPassword: string;
  newPassword: string;
};

type TRefreshAccessTokenPayload = {
  refreshToken: string;
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

  // Fetch business profile
  const businessProfile = await BusinessProfileRepository.findOne({
    userId: user._id,
  });

  const userObject = user.toObject() as ReturnType<typeof user.toObject> & {
    businessProfile?: any;
  };

  return {
    ...userObject,
    businessProfile: businessProfile ? { id: businessProfile._id } : null,
  };
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

  // Fetch business profile
  const businessProfile = await BusinessProfileRepository.findOne({
    userId: user._id,
  });

  return {
    accessToken,
    refreshToken,
    user: sanitizedUser,
    businessProfile: businessProfile ? { id: businessProfile._id } : null,
  };
};

const staffLogin = async (payload: TStaffLoginPayload) => {
  const username = payload.username.trim().toLowerCase();

  const staff = await StaffRepository.findOne(
    { username },
    {
      select: "+password",
      populate: "roleId",
    },
  );

  if (!staff) {
    throw new AppError(StatusCodes.UNAUTHORIZED, "Invalid credentials");
  }

  if (!staff.isActive) {
    throw new AppError(
      StatusCodes.UNAUTHORIZED,
      "Your account does not exist or is not active",
    );
  }

  const staffWithPassword = staff as typeof staff & {
    password?: string;
    roleId?: TRole & { _id: Types.ObjectId };
  };

  const hashedPassword = staffWithPassword.password;

  if (!hashedPassword) {
    throw new AppError(
      StatusCodes.UNAUTHORIZED,
      "Password login is not available for this staff account",
    );
  }

  const isPasswordMatched = await bcrypt.compare(payload.password, hashedPassword);

  if (!isPasswordMatched) {
    throw new AppError(StatusCodes.UNAUTHORIZED, "Invalid credentials");
  }

  const role = staffWithPassword.roleId;

  if (!role) {
    throw new AppError(
      StatusCodes.UNAUTHORIZED,
      "Staff role is missing. Please contact administrator",
    );
  }

  const tokenPayload = buildStaffTokenPayload(
    staff as typeof staff & { _id: Types.ObjectId },
    role,
  );

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

  await StaffRepository.updateById(String(staff._id), { lastLogin: new Date() });

  const staffObject = staff.toObject() as ReturnType<typeof staff.toObject> & {
    password?: string;
  };

  const { password: _password, ...sanitizedStaff } = staffObject;

  return {
    accessToken,
    refreshToken,
    staff: sanitizedStaff,
    permissions: tokenPayload.permissions,
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

  // Fetch business profile
  const businessProfile = await BusinessProfileRepository.findOne({
    userId: updatedUser._id,
  });

  const userObject = updatedUser.toObject() as ReturnType<
    typeof updatedUser.toObject
  > & {
    businessProfile?: any;
  };

  return {
    ...userObject,
    businessProfile: businessProfile ? { id: businessProfile._id } : null,
  };
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

const forgotPassword = async (payload: TForgotPasswordPayload) => {
  const { email, phone } = getNormalizedIdentity(payload);

  const user = await UserRepository.findOne({
    ...(email ? { email } : { phone }),
  });

  if (!user) {
    throw new AppError(StatusCodes.NOT_FOUND, "User not found");
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
    type: "password_reset",
    provider: otpChannel.provider,
    target: otpChannel.target,
  });

  return {
    target: otpChannel.target,
    provider: otpChannel.provider,
    message: "OTP sent to your preferred channel",
  };
};

const verifyResetOtp = async (payload: TVerifyResetOtpPayload) => {
  const { email, phone } = getNormalizedIdentity(payload);

  const user = await UserRepository.findOne({
    ...(email ? { email } : { phone }),
  });

  if (!user) {
    throw new AppError(StatusCodes.NOT_FOUND, "User not found");
  }

  await OTPService.verifyOTP(
    user._id as Types.ObjectId,
    "password_reset",
    payload.otp,
  );

  const resetTokenPayload = {
    _id: user._id,
    type: "password_reset",
  };

  const resetToken = createJwtToken(
    resetTokenPayload,
    config.jwt.jwt_secret as string,
    "15m" // Valid for 15 minutes
  );

  return {
    resetToken,
  };
};

const resetPassword = async (payload: TResetPasswordPayload) => {
  let decoded: any;
  try {
    decoded = verifyJwtToken(payload.resetToken, config.jwt.jwt_secret as string);
  } catch (error) {
    throw new AppError(StatusCodes.UNAUTHORIZED, "Invalid or expired reset token");
  }

  if (decoded?.type !== "password_reset" || !decoded?._id) {
    throw new AppError(StatusCodes.UNAUTHORIZED, "Invalid reset token type");
  }

  const hashedPassword = generateHashPassword(payload.newPassword);

  const updatedUser = await UserRepository.updateById(String(decoded._id), {
    password: hashedPassword,
  });

  if (!updatedUser) {
    throw new AppError(StatusCodes.NOT_FOUND, "User not found");
  }

  return {
    message: "Password reset successful",
  };
};

const changePassword = async (userId: Types.ObjectId, payload: TChangePasswordPayload) => {
  const user = await UserRepository.findOne({ _id: userId }, { select: "+password" });

  if (!user) {
    throw new AppError(StatusCodes.NOT_FOUND, "User not found");
  }

  const userWithPassword = user as typeof user & { password?: string };
  const currentHashedPassword = userWithPassword.password;

  if (!currentHashedPassword) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "Password change is not available for this account. You might have registered via a third-party provider.",
    );
  }

  const isPasswordMatched = await bcrypt.compare(payload.oldPassword, currentHashedPassword);

  if (!isPasswordMatched) {
    throw new AppError(StatusCodes.UNAUTHORIZED, "Incorrect old password");
  }

  const newHashedPassword = generateHashPassword(payload.newPassword);

  await UserRepository.updateById(userId?.toString(), {
    password: newHashedPassword,
  });
  

  return {
    message: "Password changed successfully",
  };
};

const refreshAccessToken = async (payload: TRefreshAccessTokenPayload) => {
  let decoded: any;
  try {
    decoded = verifyJwtToken(
      payload.refreshToken,
      (config.jwt.jwt_refresh_secret || config.jwt.jwt_secret) as string,
    );
  } catch (error) {
    throw new AppError(StatusCodes.UNAUTHORIZED, "Invalid or expired refresh token");
  }

  if (decoded?.tokenType === "staff") {
    const staff = await StaffRepository.findOne(
      { _id: decoded.staffId },
      { populate: "roleId" },
    );

    if (!staff) {
      throw new AppError(StatusCodes.NOT_FOUND, "Staff not found");
    }

    if (!staff.isActive) {
      throw new AppError(
        StatusCodes.UNAUTHORIZED,
        "Your account is not active",
      );
    }

    const role = (staff as typeof staff & {
      roleId?: TRole & { _id: Types.ObjectId };
    }).roleId;

    if (!role) {
      throw new AppError(StatusCodes.NOT_FOUND, "Role not found");
    }

    const tokenPayload = buildStaffTokenPayload(
      staff as typeof staff & { _id: Types.ObjectId },
      role,
    );

    const newAccessToken = createJwtToken(
      tokenPayload,
      config.jwt.jwt_secret as string,
      config.jwt.jwt_expire_in || "7d",
    );

    return {
      accessToken: newAccessToken,
    };
  }

  const user = await UserRepository.findOne({ _id: decoded._id });

  if (!user) {
    throw new AppError(StatusCodes.NOT_FOUND, "User not found");
  }

  if (user.status !== "active") {
    throw new AppError(
      StatusCodes.UNAUTHORIZED,
      "Your account is not active",
    );
  }

  const tokenPayload = buildTokenPayload(user);

  const newAccessToken = createJwtToken(
    tokenPayload,
    config.jwt.jwt_secret as string,
    config.jwt.jwt_expire_in || "7d",
  );

  return {
    accessToken: newAccessToken,
  };
};

export const AuthService = {
  register,
  login,
  staffLogin,
  verifyAccount,
  resendOtp,
  forgotPassword,
  verifyResetOtp,
  resetPassword,
  changePassword,
  refreshAccessToken,
};

