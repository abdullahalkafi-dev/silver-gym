import crypto from "crypto";

interface OTPOptions {
  length?: number;
  alphanumeric?: boolean;
}

const generateOTP = (options: OTPOptions = {}): string => {
  const { length = 6, alphanumeric = false } = options;

  if (alphanumeric) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let otp = "";
    for (let i = 0; i < length; i++) {
      otp += chars[crypto.randomInt(0, chars.length)];
    }
    return otp;
  }

  // Generate numeric OTP: 012345
  const max = Math.pow(10, length);
  const otp = crypto.randomInt(0, max);
  return otp.toString().padStart(length, "0");
};

export default generateOTP;
