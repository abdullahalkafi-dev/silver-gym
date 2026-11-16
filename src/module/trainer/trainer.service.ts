import { StatusCodes } from "http-status-codes";
import { Types } from "mongoose";

import AppError from "../../errors/AppError";
import generateHashPassword from "../../utils/generateHashPassword";
import { normalizeBangladeshPhone } from "../../utils/bangladeshPhone";
import { StaffRepository } from "../staff/staff.repository";
import { isValidUsername } from "../staff/staff.util";
import { Trainer } from "./trainer.model";

// Usernames are shared with dashboard staff logins, so keep them unique across both.
const isUsernameTaken = async (username: string) => {
  const [staff, trainer] = await Promise.all([
    StaffRepository.findOne({ username }),
    Trainer.findOne({ username }).lean(),
  ]);
  return Boolean(staff || trainer);
};

const normalizePhone = (phone?: string) => {
  if (!phone?.trim()) return undefined;
  const normalized = normalizeBangladeshPhone(phone);
  if (!normalized) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "Phone must be a valid Bangladesh mobile number",
    );
  }
  return normalized;
};

const checkUsername = async (username: string) => {
  const value = username.trim().toLowerCase();
  if (!isValidUsername(value)) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Invalid username format");
  }
  return { username: value, isAvailable: !(await isUsernameTaken(value)) };
};

const list = (branchId: string) =>
  Trainer.find({ branchId: new Types.ObjectId(branchId) })
    .sort({ createdAt: -1 })
    .lean();

const create = async (
  branchId: string,
  payload: { username: string; displayName: string; phone?: string; password: string },
) => {
  const username = payload.username.trim().toLowerCase();
  if (!isValidUsername(username)) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Invalid username format");
  }
  if (await isUsernameTaken(username)) {
    throw new AppError(StatusCodes.CONFLICT, "Username already exists");
  }

  const trainer = await Trainer.create({
    branchId: new Types.ObjectId(branchId),
    username,
    displayName: payload.displayName.trim(),
    phone: normalizePhone(payload.phone),
    password: await generateHashPassword(payload.password),
  });

  const { password: _password, ...safe } = trainer.toObject();
  return safe;
};

const update = async (
  branchId: string,
  trainerId: string,
  payload: { displayName?: string; phone?: string; isActive?: boolean; password?: string },
) => {
  if (!Types.ObjectId.isValid(trainerId)) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Invalid trainer id");
  }

  const set: Record<string, unknown> = {};
  if (payload.displayName !== undefined) set.displayName = payload.displayName.trim();
  if (payload.phone !== undefined) set.phone = normalizePhone(payload.phone) ?? "";
  if (payload.isActive !== undefined) set.isActive = payload.isActive;
  if (payload.password) set.password = await generateHashPassword(payload.password);

  const trainer = await Trainer.findOneAndUpdate(
    { _id: new Types.ObjectId(trainerId), branchId: new Types.ObjectId(branchId) },
    { $set: set },
    { returnDocument: "after" },
  ).lean();

  if (!trainer) {
    throw new AppError(StatusCodes.NOT_FOUND, "Trainer not found");
  }

  return trainer;
};

const remove = async (branchId: string, trainerId: string) => {
  if (!Types.ObjectId.isValid(trainerId)) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Invalid trainer id");
  }
  const result = await Trainer.deleteOne({
    _id: new Types.ObjectId(trainerId),
    branchId: new Types.ObjectId(branchId),
  });
  if (!result.deletedCount) {
    throw new AppError(StatusCodes.NOT_FOUND, "Trainer not found");
  }
  return { deleted: true };
};

export const TrainerService = { checkUsername, list, create, update, remove };
