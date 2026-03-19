import { Router } from "express";

import validateRequest from "@middlewares/validateRequest";
import { AuthController } from "./auth.controller";
import { AuthDto } from "./auth.dto";

const router = Router();

/**
 * @route   POST /api/v1/auth/register
 * @desc    Register a new user account (email, phone, or google provider)
 * @access  Public
 */
router.post(
  "/register",
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
  validateRequest(AuthDto.resendOtp),
  AuthController.resendOtp,
);

export const AuthRoutes = router;
