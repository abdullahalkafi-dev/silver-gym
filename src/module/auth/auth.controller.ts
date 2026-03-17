import { StatusCodes } from "http-status-codes";

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

export const AuthController = {
  register,
  login,
  verifyAccount,
  resendOtp,
};
