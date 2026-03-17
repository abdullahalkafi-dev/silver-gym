import { StatusCodes } from "http-status-codes";

import AppError from "../../errors/AppError";
import { LoginProvider, TUser } from "./user.interface";
import { UserRepository } from "./user.repository";

const createUser = async (payload: TUser) => {
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
    // Clean up unverified duplicates
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
    // Clean up unverified duplicates
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
  return user;
};


export const UserService = {
  createUser,
};
