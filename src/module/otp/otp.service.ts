import { Types } from "mongoose";
import bcrypt from "bcryptjs";
import { OTPType, createOTPData } from "./otp.interface";
import { OTPRepository } from "./otp.repository";
import { StatusCodes } from "http-status-codes/build/cjs/status-codes";
import AppError from "errors/AppError";
import config from "config";
import { logger } from "logger/logger";
import { TCreateAccount, TResetPassword } from "mail/emailTemplate.type";
import { emailTemplate } from "mail/emailTemplate";
import { emailHelper } from "mail/emailHelper";

const OTP_BCRYPT_ROUNDS = Number(config.bcrypt_salt_rounds) || 10;

const createOTP = async (createOtpData: createOTPData) => {
  const { userId, type, provider, target, name } = createOtpData;
  // Delete any existing unused OTPs of same type
  await OTPRepository.deleteMany({ userId, type, isUsed: false });
  //TODO- for development purposes
  const otp = "123456"; //generateOTP();

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
  logger.info(`OTP created for user ${userId} with type ${type} and provider ${provider}`);
  //send mail or sms with the OTP here using provider and target info //TODO - integrate with SMS service

  if (provider === "email" && target) {
    //TODO - temporarily disable email sending in development to avoid spamming real email accounts. Make sure to test email sending functionality before production deployment.
    if (type === "password_reset") {
      const mailSendingData: TResetPassword = {
        name: name || "User",
        email: target,
        otp,
        theme: "theme-blue",
        expiresIn: 30,
      };
      const data = emailTemplate.resetPassword(mailSendingData);
      await emailHelper.sendEmail(data);
    } else {
      const mailSendingData: TCreateAccount = {
        name: name || "User",
        email: target,
        otp,
        theme: "theme-blue",
      };
      const data = emailTemplate.createAccount(mailSendingData);
      console.log(data);
      //TODO - reenable email sending before production release
      // await emailHelper.sendEmail(data);
    }
  }

  return { otp, otpDoc };
};

// Verify OTP
const verifyOTP = async (
  userId: Types.ObjectId,
  type: OTPType,
  inputOTP: string,
) => {
  const now = new Date();
  const otpDoc = await OTPRepository.findOne({
    userId,
    type,
    isUsed: false,
    expiresAt: { $gt: now },
    $expr: { $lt: ["$attempts", "$maxAttempts"] },
  }).select("+otp");

  if (!otpDoc) {
    const exhaustedOtpDoc = await OTPRepository.findOne({
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
    const verifiedOtpDoc = await OTPRepository.findOneAndUpdate(
      {
        _id: otpDoc._id,
        isUsed: false,
        expiresAt: { $gt: now },
        $expr: { $lt: ["$attempts", "$maxAttempts"] },
      },
      { $set: { isUsed: true } },
      { returnDocument: 'after' },
    );

    if (verifiedOtpDoc) {
      return verifiedOtpDoc;
    }

    throw new AppError(StatusCodes.BAD_REQUEST, "OTP expired or not found");
  }

  // Atomic failed-attempt increment with lock on max attempts.
  const failedAttemptDoc = await OTPRepository.findOneAndUpdate(
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
    { returnDocument: 'after' },
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
