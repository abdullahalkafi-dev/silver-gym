import { Router } from "express";
import validateRequest from "@middlewares/validateRequest";
import { AuthController } from "./auth.controller";
import { AuthDto } from "./auth.dto";
import { authLimiter, strictLimiter } from "@middlewares/security";
import auth from "@middlewares/auth";

const router = Router();

/**
 * @route   POST /api/v1/auth/register
 * @desc    Register a new user account (email, phone, or google provider)
 * @access  Public
 */
router.post(
  "/register",
  authLimiter,
  validateRequest(AuthDto.register),
  AuthController.register,
);

/**
 * @route   POST /api/v1/auth/login
 * @desc    Login user with email/phone and password
 * @access  Public
 */
router.post(
  "/login",
  authLimiter,
  validateRequest(AuthDto.login),
  AuthController.login,
);

/**
 * @route   POST /api/v1/auth/verify-account
 * @desc    Verify account with OTP for email or phone
 * @access  Public
 */
router.post(
  "/verify-account",
  authLimiter,
  validateRequest(AuthDto.verifyAccount),
  AuthController.verifyAccount,
);

/**
 * @route   POST /api/v1/auth/resend-otp
 * @desc    Resend OTP for account verification or other OTP types
 * @access  Public
 */
router.post(
  "/resend-otp",
  strictLimiter,
  validateRequest(AuthDto.resendOtp),
  AuthController.resendOtp,
);

/**
 * @route   POST /api/v1/auth/forgot-password
 * @desc    Send OTP to email/phone for password reset
 * @access  Public
 */
router.post(
  "/forgot-password",
  strictLimiter,
  validateRequest(AuthDto.forgotPassword),
  AuthController.forgotPassword,
);

/**
 * @route   POST /api/v1/auth/verify-reset-otp
 * @desc    Verify OTP for password reset and get reset token
 * @access  Public
 */
router.post(
  "/verify-reset-otp",
  strictLimiter,
  validateRequest(AuthDto.verifyResetOtp),
  AuthController.verifyResetOtp,
);

/**
 * @route   POST /api/v1/auth/reset-password
 * @desc    Reset password using reset token
 * @access  Public
 */
router.post(
  "/reset-password",
  strictLimiter,
  validateRequest(AuthDto.resetPassword),
  AuthController.resetPassword,
);

/**
 * @route   POST /api/v1/auth/change-password
 * @desc    Change password using old password
 * @access  Private
 */
router.post(
  "/change-password",
  authLimiter,
  auth(),
  validateRequest(AuthDto.changePassword),
  AuthController.changePassword,
);

export const AuthRoutes = router;
