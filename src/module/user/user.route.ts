import { Router } from "express";
import { UserController } from "./user.controller";
import validateRequest from "@middlewares/validateRequest";
import { UserDto } from "./user.dto";

const router = Router();
router.post(
  "/register",
  validateRequest(UserDto.create),
  UserController.createUser,
);
export const UserRoutes = router;
