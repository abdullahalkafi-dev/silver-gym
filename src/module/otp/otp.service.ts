import { Types } from "mongoose";
import bcrypt from "bcryptjs";
import { OTPProvider, OTPType } from "./otp.interface";
import { OTPRepository } from "./otp.repository";
import generateOTP from "util/generateOTP";
import { StatusCodes } from "http-status-codes/build/cjs/status-codes";
import AppError from "errors/AppError";
import config from "config";
import { OTP } from "./otp.model";

const OTP_BCRYPT_ROUNDS = Number(config.bcrypt_salt_rounds) || 10;

const createOTP = async (
  userId: Types.ObjectId,
  type: OTPType,
  provider: OTPProvider,
  target: string,
) => {
  // Delete any existing unused OTPs of same type
  await OTPRepository.deleteMany({ userId, type, isUsed: false });

  const otp = generateOTP();
  const otpHash = await bcrypt.hash(otp, OTP_BCRYPT_ROUNDS);
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

  const otpDoc = await OTPRepository.create({
    userId,
    otp: otpHash,
    type,
    provider,
    target,
    expiresAt,
    maxAttempts: 5,
  });

  return { otp, otpDoc };
};

// Verify OTP
const verifyOTP = async (
  userId: Types.ObjectId,
  type: OTPType,
  inputOTP: string,
) => {
  const now = new Date();
  const otpDoc = await OTP.findOne({
    userId,
    type,
    isUsed: false,
    expiresAt: { $gt: now },
    $expr: { $lt: ["$attempts", "$maxAttempts"] },
  }).select("+otp");

  if (!otpDoc) {
    const exhaustedOtpDoc = await OTP.findOne({
      userId,
      type,
      expiresAt: { $gt: now },
      $expr: { $gte: ["$attempts", "$maxAttempts"] },
    });

    if (exhaustedOtpDoc) {
      throw new AppError(
        StatusCodes.TOO_MANY_REQUESTS,
        "Too many failed attempts",
      );
    }

    throw new AppError(StatusCodes.BAD_REQUEST, "OTP expired or not found");
  }

  const isMatched = await bcrypt.compare(inputOTP, otpDoc.otp);

  if (isMatched) {
    const verifiedOtpDoc = await OTP.findOneAndUpdate(
      {
        _id: otpDoc._id,
        isUsed: false,
        expiresAt: { $gt: now },
        $expr: { $lt: ["$attempts", "$maxAttempts"] },
      },
      { $set: { isUsed: true } },
      { new: true },
    );

    if (verifiedOtpDoc) {
      return verifiedOtpDoc;
    }

    throw new AppError(StatusCodes.BAD_REQUEST, "OTP expired or not found");
  }

  // Atomic failed-attempt increment with lock on max attempts.
  const failedAttemptDoc = await OTP.findOneAndUpdate(
    {
      _id: otpDoc._id,
      isUsed: false,
      expiresAt: { $gt: now },
      $expr: { $lt: ["$attempts", "$maxAttempts"] },
    },
    [
      {
        $set: {
          attempts: { $add: ["$attempts", 1] },
          isUsed: {
            $cond: [
              { $gte: [{ $add: ["$attempts", 1] }, "$maxAttempts"] },
              true,
              "$isUsed",
            ],
          },
        },
      },
    ],
    { new: true },
  );

  if (failedAttemptDoc) {
    if (failedAttemptDoc.attempts >= failedAttemptDoc.maxAttempts) {
      throw new AppError(
        StatusCodes.TOO_MANY_REQUESTS,
        "Too many failed attempts",
      );
    }

    throw new AppError(StatusCodes.BAD_REQUEST, "Invalid OTP");
  }

  throw new AppError(StatusCodes.BAD_REQUEST, "OTP expired or not found");
};
export const OTPService = {
  createOTP,
  verifyOTP,
};
