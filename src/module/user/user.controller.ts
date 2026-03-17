import sendResponse from "@shared/sendResponse";
import { StatusCodes } from "http-status-codes";
import { UserService } from "./user.service";
import catchAsync from "@shared/catchAsync";

const createUser = catchAsync(async (req, res) => {
  const user = await UserService.createUser(req.body);
 sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: "User created successfully",
    data: user,

});});

export const UserController = {
  createUser,
};