import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { Types } from "mongoose";
import AppError from "../../errors/AppError";
import catchAsync from "../../shared/catchAsync";
import sendResponse from "../../shared/sendResponse";
import { UserService } from "./user.service";

const getMe = catchAsync(async (req: Request, res: Response) => {
	if (!req.user?._id) {
		throw new AppError(StatusCodes.UNAUTHORIZED, "Authentication required");
	}
	const userId = new Types.ObjectId(req.user._id);
	const profile = await UserService.getMyProfile(userId);

	sendResponse(res, {
		statusCode: StatusCodes.OK,
		success: true,
		message: "User profile retrieved successfully",
		data: profile,
	});
});

const updateProfile = catchAsync(async (req: Request, res: Response) => {
	if (!req.user?._id) {
		throw new AppError(StatusCodes.UNAUTHORIZED, "Authentication required");
	}
	const userId = new Types.ObjectId(req.user._id);
	const imageFile = (req.files as any)?.image?.[0] as Express.Multer.File | undefined;

	let payload = req.body.data ?? req.body;
	if (typeof payload === "string") {
		try {
			payload = JSON.parse(payload);
		} catch {
			throw new AppError(StatusCodes.BAD_REQUEST, "Invalid JSON in request data");
		}
	}

	const profile = await UserService.updateProfile(userId, payload, imageFile);

	sendResponse(res, {
		statusCode: StatusCodes.OK,
		success: true,
		message: "User profile updated successfully",
		data: profile,
	});
});

export const UserController = {
	getMe,
	updateProfile,
};
