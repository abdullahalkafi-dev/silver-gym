import { Router } from "express";

import validateRequest from "@middlewares/validateRequest";
import { AuthController } from "./auth.controller";
import { AuthDto } from "./auth.dto";

const router = Router();

router.post(
  "/register",
  validateRequest(AuthDto.register),
  AuthController.register,
);

router.post(
  "/login",
  validateRequest(AuthDto.login),
  AuthController.login,
);

router.post(
  "/verify-account",
  validateRequest(AuthDto.verifyAccount),
  AuthController.verifyAccount,
);

router.post(
  "/resend-otp",
  validateRequest(AuthDto.resendOtp),
  AuthController.resendOtp,
);

export const AuthRoutes = router;
