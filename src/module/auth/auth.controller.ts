import { StatusCodes } from "http-status-codes";

import AppError from "errors/AppError";
import catchAsync from "@shared/catchAsync";
import sendResponse from "@shared/sendResponse";
import { AuthService } from "./auth.service";

const register = catchAsync(async (req, res) => {
  const user = await AuthService.register(req.body);

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: "Account created successfully",
    data: user,
  });
});

const login = catchAsync(async (req, res) => {
  const result = await AuthService.login(req.body);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Login successful",
    data: result,
  });
});

const staffLogin = catchAsync(async (req, res) => {
  const result = await AuthService.staffLogin(req.body);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Staff login successful",
    data: result,
  });
});

const verifyAccount = catchAsync(async (req, res) => {
  const user = await AuthService.verifyAccount(req.body);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Account verified successfully",
    data: user,
  });
});

const resendOtp = catchAsync(async (req, res) => {
  const result = await AuthService.resendOtp(req.body);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "OTP sent successfully",
    data: result,
  });
});

const forgotPassword = catchAsync(async (req, res) => {
  const result = await AuthService.forgotPassword(req.body);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Password reset OTP sent successfully",
    data: result,
  });
});

const verifyResetOtp = catchAsync(async (req, res) => {
  const result = await AuthService.verifyResetOtp(req.body);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "OTP verified successfully",
    data: result, // Contains the resetToken
  });
});

const resetPassword = catchAsync(async (req, res) => {
  const result = await AuthService.resetPassword(req.body);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: result.message,
    data: null,
  });
});

const changePassword = catchAsync(async (req, res) => {
  const userId = req.user?._id;

  if (!userId) {
    throw new AppError(StatusCodes.UNAUTHORIZED, "You are not authorized");
  }

  const result = await AuthService.changePassword(userId, req.body);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: result.message,
    data: null,
  });
});

const refreshAccessToken = catchAsync(async (req, res) => {
  const result = await AuthService.refreshAccessToken(req.body);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Access token refreshed successfully",
    data: result,
  });
});

export const AuthController = {
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

