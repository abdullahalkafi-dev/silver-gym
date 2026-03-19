import { body } from "express-validator";

export const validateObjectId = (field: string) =>
  body(field)
    .isMongoId()
    .withMessage(`${field} must be a valid MongoDB ObjectId`);