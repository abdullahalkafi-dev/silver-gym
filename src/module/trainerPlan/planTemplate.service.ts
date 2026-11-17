import { StatusCodes } from "http-status-codes";
import { Types } from "mongoose";

import AppError from "../../errors/AppError";
import { PlanTemplate } from "./planTemplate.model";
import { PLAN_LIMITS } from "./trainerPlan.constants";
import { cleanRichText, richTextToPlain } from "./trainerPlan.richText";

const toId = (value: unknown) => new Types.ObjectId(String(value));

const FIELDS = "_id title content createdAt updatedAt";

const cleanContent = (html: string) => {
  const content = cleanRichText(html);
  if (!richTextToPlain(content)) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Please write something in the template");
  }
  return content;
};

const findOwn = async (trainerId: string, templateId: string) => {
  if (!Types.ObjectId.isValid(templateId)) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Invalid template id");
  }
  const template = await PlanTemplate.findOne({ _id: toId(templateId), trainerId: toId(trainerId) });
  if (!template) throw new AppError(StatusCodes.NOT_FOUND, "Template not found");
  return template;
};

const list = (trainerId: string) =>
  PlanTemplate.find({ trainerId: toId(trainerId) })
    .select(FIELDS)
    .sort({ updatedAt: -1 })
    .lean();

const get = async (trainerId: string, templateId: string) => {
  const template = await findOwn(trainerId, templateId);
  const { _id, title, content, createdAt, updatedAt } = template.toObject();
  return { _id, title, content, createdAt, updatedAt };
};

const create = async (
  trainerId: string,
  branchId: string,
  input: { title: string; content: string },
) => {
  const count = await PlanTemplate.countDocuments({ trainerId: toId(trainerId) });
  if (count >= PLAN_LIMITS.templatesPerTrainer) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      `You can keep up to ${PLAN_LIMITS.templatesPerTrainer} templates. Please delete one first.`,
    );
  }
  const template = await PlanTemplate.create({
    trainerId: toId(trainerId),
    branchId: toId(branchId),
    title: input.title.trim(),
    content: cleanContent(input.content),
  });
  return get(trainerId, String(template._id));
};

const update = async (
  trainerId: string,
  templateId: string,
  input: { title?: string; content?: string },
) => {
  const template = await findOwn(trainerId, templateId);
  if (input.title !== undefined) template.title = input.title.trim();
  if (input.content !== undefined) template.content = cleanContent(input.content);
  await template.save();
  return get(trainerId, templateId);
};

const remove = async (trainerId: string, templateId: string) => {
  const template = await findOwn(trainerId, templateId);
  await template.deleteOne();
  return { deleted: true };
};

export const PlanTemplateService = { list, get, create, update, remove };
