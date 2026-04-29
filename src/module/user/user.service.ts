import { StatusCodes } from "http-status-codes";
import { Types } from "mongoose";
import AppError from "../../errors/AppError";
import unlinkFile from "../../shared/unlinkFile";
import { UserRepository } from "./user.repository";

type UpdateProfilePayload = {
	firstName?: string;
	lastName?: string;
	phone?: string;
	countryCode?: string;
};

const getUploadRelativePath = (absolutePath: string) => {
	return absolutePath.replace(/.*uploads[\\/]/, "").replace(/\\/g, "/");
};

const getMyProfile = async (userId: Types.ObjectId) => {
	const user = await UserRepository.findById(String(userId));

	if (!user) {
		throw new AppError(StatusCodes.NOT_FOUND, "User not found");
	}

	return user;
};

const updateProfile = async (
	userId: Types.ObjectId,
	payload: UpdateProfilePayload,
	profileFile?: Express.Multer.File
) => {
	const user = await UserRepository.findById(String(userId));

	if (!user) {
		if (profileFile) {
			await unlinkFile(getUploadRelativePath(profileFile.path));
		}
		throw new AppError(StatusCodes.NOT_FOUND, "User not found");
	}

	if (profileFile && user.profilePicture) {
		await unlinkFile(user.profilePicture);
	}

	const updatePayload = {
		...payload,
		...(profileFile ? { profilePicture: getUploadRelativePath(profileFile.path) } : {}),
	};

	const updatedUser = await UserRepository.updateById(String(userId), updatePayload);

	if (!updatedUser) {
		if (profileFile) {
			await unlinkFile(getUploadRelativePath(profileFile.path));
		}
		throw new AppError(StatusCodes.INTERNAL_SERVER_ERROR, "Failed to update profile");
	}

	return updatedUser;
};

export const UserService = {
	getMyProfile,
	updateProfile,
};
