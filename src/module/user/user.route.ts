import { Router } from "express";
import { authLimiter } from "@middlewares/security";
import auth from "@middlewares/auth";
import fileUploadHandler from "@middlewares/fileUploadHandler";
import { UserController } from "./user.controller";

const router = Router();

router.get("/me", auth(), UserController.getMe);

router.patch(
	"/update-profile",
	authLimiter,
	auth(),
	fileUploadHandler,
	UserController.updateProfile
);

export const UserRoutes = router;
