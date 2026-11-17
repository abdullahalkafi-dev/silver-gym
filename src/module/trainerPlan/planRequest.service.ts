import { StatusCodes } from "http-status-codes";
import { Types } from "mongoose";

import AppError from "../../errors/AppError";
import { Member } from "../member/member.model";
import { Trainer } from "../trainer/trainer.model";
import { PlanRequest } from "./planRequest.model";
import { PlanTemplate } from "./planTemplate.model";
import {
  CUSTOM_TOPIC_FILTER,
  PLAN_LIMITS,
  PLAN_REQUEST_STATUSES,
  PLAN_TOPICS,
  TRAINER_REMOVED_REASON,
  TPlanRequestStatus,
} from "./trainerPlan.constants";
import { cleanRichText, richTextToPlain } from "./trainerPlan.richText";

// Filters are typed loosely on purpose: the server's newer mongoose typings are stricter
// than the local ones about `$in` on enum fields (see memberUpdateRequest.service).
type TFilter = Record<string, any>;

type TListQuery = {
  status?: TPlanRequestStatus | "all";
  topic?: string;
  search?: string;
  from?: string;
  to?: string;
  page?: string;
  limit?: string;
};

const toId = (value: unknown) => new Types.ObjectId(String(value));

const assertId = (value: string, label: string) => {
  if (!Types.ObjectId.isValid(value)) {
    throw new AppError(StatusCodes.BAD_REQUEST, `Invalid ${label} id`);
  }
};

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const notFound = () => new AppError(StatusCodes.NOT_FOUND, "Request not found");

/** Age in whole years, by Bangladesh calendar day (date of birth is stored as Dhaka midnight). */
export const ageOn = (dateOfBirth: Date | string | null | undefined, now = new Date()) => {
  if (!dateOfBirth) return undefined;
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return undefined;
  const day = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Dhaka" });
  const [by, bm, bd] = day(dob).split("-").map(Number) as [number, number, number];
  const [ny, nm, nd] = day(now).split("-").map(Number) as [number, number, number];
  let age = ny - by;
  if (nm < bm || (nm === bm && nd < bd)) age -= 1;
  return age >= 0 && age < 130 ? age : undefined;
};

const pageOf = (query: TListQuery) => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(query.limit) || 20));
  return { page, limit, skip: (page - 1) * limit };
};

/** Status / topic / search / date filters shared by the trainer inbox and the dashboard. */
const applyListFilters = (base: TFilter, query: TListQuery): TFilter => {
  const filter: TFilter = { ...base };

  if (query.status && query.status !== "all") filter.status = query.status;

  if (query.topic) {
    if (query.topic === CUSTOM_TOPIC_FILTER) filter.isCustomTopic = true;
    else {
      filter.topic = query.topic;
      filter.isCustomTopic = { $ne: true };
    }
  }

  if (query.search) {
    const pattern = new RegExp(escapeRegex(query.search), "i");
    filter.$or = [
      { "memberSnapshot.fullName": pattern },
      { "memberSnapshot.memberId": pattern },
      { topic: pattern },
    ];
  }

  // `from`/`to` are whole Bangladesh days (UTC+6, no daylight saving).
  if (query.from || query.to) {
    filter.createdAt = {};
    if (query.from) filter.createdAt.$gte = new Date(`${query.from}T00:00:00+06:00`);
    if (query.to) {
      const end = new Date(`${query.to}T00:00:00+06:00`);
      end.setUTCDate(end.getUTCDate() + 1);
      filter.createdAt.$lt = end;
    }
  }

  return filter;
};

const statusCounts = async (base: TFilter) => {
  const rows = await PlanRequest.aggregate([
    { $match: base },
    { $group: { _id: "$status", n: { $sum: 1 } } },
  ]);
  const counts: Record<TPlanRequestStatus | "total", number> = {
    total: 0,
    pending: 0,
    answered: 0,
    declined: 0,
    cancelled: 0,
  };
  for (const row of rows) {
    if ((PLAN_REQUEST_STATUSES as readonly string[]).includes(row._id)) {
      counts[row._id as TPlanRequestStatus] = row.n;
      counts.total += row.n;
    }
  }
  return counts;
};

const listPage = async (base: TFilter, query: TListQuery) => {
  const { page, limit, skip } = pageOf(query);
  const filter = applyListFilters(base, query);
  const [items, total, counts] = await Promise.all([
    PlanRequest.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    PlanRequest.countDocuments(filter),
    statusCounts(base),
  ]);
  return {
    items,
    counts,
    meta: { page, limit, total, totalPage: Math.max(1, Math.ceil(total / limit)) },
  };
};

/* ─── Member ─────────────────────────────────────────────────────────────────── */

const MEMBER_FIELDS = "-branchId -memberId -trainerId -__v";

/** Active trainers of the member's own branch (an empty list hides the feature). */
const listTrainersForMember = async (branchId: string) => {
  const trainers = await Trainer.find({ branchId: toId(branchId), isActive: true })
    .select("_id displayName")
    .sort({ displayName: 1 })
    .lean();
  return trainers.map((t) => ({ id: String(t._id), displayName: t.displayName }));
};

const submit = async (
  memberDbId: string,
  branchId: string,
  input: {
    trainerId: string;
    topic: string;
    isCustomTopic?: boolean;
    note?: string;
    height?: number;
    heightUnit?: "cm" | "in" | "ft";
    weight?: number;
    weightUnit?: "kg" | "lb";
  },
) => {
  const isCustomTopic = Boolean(input.isCustomTopic);
  const topic = input.topic.trim();
  if (!isCustomTopic && !(PLAN_TOPICS as readonly string[]).includes(topic)) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Please choose what you need");
  }

  const [member, trainer] = await Promise.all([
    Member.findOne({ _id: toId(memberDbId), branchId: toId(branchId), isActive: true }).lean(),
    Trainer.findOne({ _id: toId(input.trainerId), branchId: toId(branchId), isActive: true })
      .select("_id displayName")
      .lean(),
  ]);

  if (!member) throw new AppError(StatusCodes.NOT_FOUND, "Member not found");
  if (!trainer) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "This trainer is not available. Please choose another trainer.",
    );
  }

  // Values typed in the form only fill this request; the profile is never changed here.
  const height = input.height ?? member.height ?? undefined;
  const heightUnit = input.height ? input.heightUnit ?? "cm" : member.heightUnit ?? "cm";
  const weight = input.weight ?? member.weight ?? undefined;
  const weightUnit = input.weight ? input.weightUnit ?? "kg" : member.weightUnit ?? "kg";

  if (!height || !weight) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "Please add your height and weight so the trainer can plan for you",
    );
  }

  try {
    const created = await PlanRequest.create({
      branchId: member.branchId,
      memberId: member._id,
      trainerId: trainer._id,
      trainerName: trainer.displayName,
      topic,
      isCustomTopic,
      note: input.note?.trim() || undefined,
      memberSnapshot: {
        fullName: member.fullName,
        memberId: member.memberId,
        photo: member.photo || undefined,
        gender: member.gender || undefined,
        age: ageOn(member.dateOfBirth),
        bloodGroup: member.bloodGroup || undefined,
        height,
        heightUnit,
        weight,
        weightUnit,
        trainingGoals: member.trainingGoals?.length ? member.trainingGoals : undefined,
      },
      status: "pending",
    });
    const { branchId: _b, memberId: _m, trainerId: _t, ...safe } = created.toObject();
    return safe;
  } catch (error: any) {
    if (error?.code === 11000) {
      throw new AppError(
        StatusCodes.CONFLICT,
        "You already have a request waiting for a trainer. Please wait for the answer or cancel it first.",
      );
    }
    throw error;
  }
};

const listForMember = (memberDbId: string) =>
  PlanRequest.find({ memberId: toId(memberDbId) })
    .select(MEMBER_FIELDS)
    .sort({ createdAt: -1 })
    .limit(PLAN_LIMITS.memberHistory)
    .lean();

const getForMember = async (memberDbId: string, requestId: string) => {
  assertId(requestId, "request");
  const request = await PlanRequest.findOne({ _id: toId(requestId), memberId: toId(memberDbId) })
    .select(MEMBER_FIELDS)
    .lean();
  if (!request) throw notFound();
  return request;
};

const cancelForMember = async (memberDbId: string, requestId: string) => {
  assertId(requestId, "request");
  const request = await PlanRequest.findOneAndUpdate(
    { _id: toId(requestId), memberId: toId(memberDbId), status: "pending" },
    { $set: { status: "cancelled", closedAt: new Date() } },
    { returnDocument: "after" },
  )
    .select(MEMBER_FIELDS)
    .lean();
  if (!request) {
    throw new AppError(StatusCodes.CONFLICT, "This request was already answered or closed");
  }
  return request;
};

/* ─── Trainer ────────────────────────────────────────────────────────────────── */

const listForTrainer = (trainerId: string, query: TListQuery) =>
  listPage({ trainerId: toId(trainerId) }, { ...query, from: undefined, to: undefined });

const getForTrainer = async (trainerId: string, requestId: string) => {
  assertId(requestId, "request");
  const request = await PlanRequest.findOne({ _id: toId(requestId), trainerId: toId(trainerId) }).lean();
  if (!request) throw notFound();
  return request;
};

/** First send (pending → answered) or an edit of an answered plan. */
const saveReply = async (
  trainerId: string,
  requestId: string,
  input: { title?: string; content: string },
) => {
  const request = await getForTrainer(trainerId, requestId);

  const content = cleanRichText(input.content);
  if (!richTextToPlain(content)) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Please write the plan before sending");
  }
  const title = input.title?.trim() || request.topic;
  const now = new Date();

  let updated;
  if (request.status === "pending") {
    updated = await PlanRequest.findOneAndUpdate(
      { _id: request._id, trainerId: toId(trainerId), status: "pending" },
      { $set: { status: "answered", reply: { title, content, sentAt: now }, closedAt: now } },
      { returnDocument: "after" },
    ).lean();
  } else if (request.status === "answered") {
    updated = await PlanRequest.findOneAndUpdate(
      { _id: request._id, trainerId: toId(trainerId), status: "answered" },
      { $set: { "reply.title": title, "reply.content": content, "reply.editedAt": now } },
      { returnDocument: "after" },
    ).lean();
  }

  if (!updated) {
    throw new AppError(
      StatusCodes.CONFLICT,
      request.status === "cancelled"
        ? "The member cancelled this request"
        : "This request is closed and cannot be answered",
    );
  }
  return updated;
};

const decline = async (trainerId: string, requestId: string, reason: string) => {
  assertId(requestId, "request");
  const request = await PlanRequest.findOneAndUpdate(
    { _id: toId(requestId), trainerId: toId(trainerId), status: "pending" },
    { $set: { status: "declined", declineReason: reason.trim(), closedAt: new Date() } },
    { returnDocument: "after" },
  ).lean();
  if (!request) {
    throw new AppError(StatusCodes.CONFLICT, "Only a waiting request can be declined");
  }
  return request;
};

/** Called when staff delete a trainer: free waiting members and drop private templates. */
const onTrainerRemoved = async (trainerId: string) => {
  const id = toId(trainerId);
  await Promise.all([
    PlanRequest.updateMany(
      { trainerId: id, status: "pending" },
      { $set: { status: "declined", declineReason: TRAINER_REMOVED_REASON, closedAt: new Date() } },
    ),
    PlanTemplate.deleteMany({ trainerId: id }),
  ]);
};

/* ─── Dashboard (owner / staff, read only) ─────────────────────────────────── */

const branchSummary = async (branchId: string) => {
  const rows = await PlanRequest.aggregate([
    { $match: { branchId: toId(branchId) } },
    { $group: { _id: { trainerId: "$trainerId", status: "$status" }, n: { $sum: 1 } } },
  ]);
  const summary: Record<string, Record<TPlanRequestStatus | "total", number>> = {};
  for (const row of rows) {
    const key = String(row._id.trainerId);
    summary[key] ??= { total: 0, pending: 0, answered: 0, declined: 0, cancelled: 0 };
    const status = row._id.status as TPlanRequestStatus;
    if (status in summary[key]) {
      summary[key][status] += row.n;
      summary[key].total += row.n;
    }
  }
  return summary;
};

const listForStaff = async (branchId: string, trainerId: string, query: TListQuery) => {
  assertId(trainerId, "trainer");
  const trainer = await Trainer.findOne({ _id: toId(trainerId), branchId: toId(branchId) })
    .select("_id displayName username isActive lastLogin")
    .lean();
  if (!trainer) throw new AppError(StatusCodes.NOT_FOUND, "Trainer not found");

  const result = await listPage({ branchId: toId(branchId), trainerId: trainer._id }, query);
  return { trainer, ...result };
};

export const PlanRequestService = {
  listTrainersForMember,
  submit,
  listForMember,
  getForMember,
  cancelForMember,
  listForTrainer,
  getForTrainer,
  saveReply,
  decline,
  onTrainerRemoved,
  branchSummary,
  listForStaff,
};
