import { StatusCodes } from "http-status-codes";
import { Types } from "mongoose";

import AppError from "../../errors/AppError";
import { TBranchActor } from "../../shared/branchAccess";
import unlinkFile from "../../shared/unlinkFile";
import { Member } from "../member/member.model";
import { MemberService } from "../member/member.service";
import {
  REQUEST_FIELD_KEYS,
  TRequestFieldKey,
  currentFieldValue,
  isSameValue,
  requestFieldsSchema,
  toMemberPayload,
} from "./memberUpdateRequest.fields";
import { MemberUpdateRequest } from "./memberUpdateRequest.model";

type TChanges = Record<string, { old: unknown; new: unknown }>;

// Loose type: newer mongoose typings reject a plain string[] inside `$in` on the status field.
const OPEN_STATUSES: any[] = ["pending", "processing"];

const toKey = (value: unknown) => new Types.ObjectId(String(value));

const removePhoto = async (key?: string | null) => {
  if (key) {
    await unlinkFile(key);
  }
};

/**
 * Member submits (or adds to) their pending request.
 *
 * - Only fields that differ from the member's CURRENT value are kept.
 * - Fields sent earlier in the same open request stay unless re-sent.
 * - Nothing can be blanked: empty values never pass validation.
 */
const submit = async (
  memberDbId: string,
  rawFields: unknown,
  newPhotoKey?: string,
) => {
  const parsed = requestFieldsSchema.safeParse(rawFields ?? {});
  if (!parsed.success) {
    await removePhoto(newPhotoKey);
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      parsed.error.issues[0]?.message ?? "Invalid request data",
    );
  }

  const member = await Member.findOne({ _id: toKey(memberDbId), isActive: true }).lean();
  if (!member) {
    await removePhoto(newPhotoKey);
    throw new AppError(StatusCodes.NOT_FOUND, "Member not found");
  }

  const existing = await MemberUpdateRequest.findOne({
    memberId: member._id,
    status: "pending",
  });

  // Requested values: earlier pending ones, overridden by what was just sent.
  const requestedValues: Record<string, unknown> = {};
  if (existing) {
    for (const [key, change] of Object.entries((existing.changes ?? {}) as TChanges)) {
      requestedValues[key] = change.new;
    }
  }
  Object.assign(requestedValues, parsed.data);

  const changes: TChanges = {};
  for (const key of REQUEST_FIELD_KEYS) {
    if (!(key in requestedValues)) continue;
    const current = currentFieldValue(member, key);
    if (isSameValue(key, current, requestedValues[key])) continue; // nothing to change
    changes[key] = { old: current, new: requestedValues[key] };
  }

  const hasPhoto = Boolean(newPhotoKey || existing?.photo?.newKey);
  if (!Object.keys(changes).length && !hasPhoto) {
    await removePhoto(newPhotoKey);
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "Nothing to update. The values you entered match your current profile.",
    );
  }

  const photo = hasPhoto
    ? {
        newKey: newPhotoKey ?? existing?.photo?.newKey,
        oldKey: member.photo || undefined,
      }
    : undefined;

  if (newPhotoKey && existing?.photo?.newKey && existing.photo.newKey !== newPhotoKey) {
    await removePhoto(existing.photo.newKey); // replaced before anyone reviewed it
  }

  if (existing) {
    existing.changes = changes;
    existing.set("photo", photo);
    existing.markModified("changes");
    await existing.save();
    return existing.toObject();
  }

  try {
    const created = await MemberUpdateRequest.create({
      branchId: member.branchId,
      memberId: member._id,
      status: "pending",
      changes,
      photo,
    });
    return created.toObject();
  } catch (error: any) {
    if (error?.code === 11000) {
      throw new AppError(
        StatusCodes.CONFLICT,
        "Your request is being reviewed right now. Please try again in a moment.",
      );
    }
    throw error;
  }
};

/** Member: the open request (if any) plus the latest finished one. */
const getForMember = async (memberDbId: string) => {
  const [pending, latest] = await Promise.all([
    MemberUpdateRequest.findOne({
      memberId: toKey(memberDbId),
      status: { $in: OPEN_STATUSES },
    }).lean(),
    MemberUpdateRequest.findOne({
      memberId: toKey(memberDbId),
      status: { $in: ["approved", "partially_approved", "rejected"] },
    })
      .sort({ reviewedAt: -1 })
      .lean(),
  ]);
  return { pending, latest };
};

const cancelForMember = async (memberDbId: string) => {
  const request = await MemberUpdateRequest.findOneAndUpdate(
    { memberId: toKey(memberDbId), status: "pending" },
    { $set: { status: "cancelled", reviewedAt: new Date() } },
    { returnDocument: "after" },
  ).lean();

  if (!request) {
    throw new AppError(StatusCodes.NOT_FOUND, "No pending request to cancel");
  }

  await removePhoto(request.photo?.newKey);
  return request;
};

/** Staff: the open request for a member, with each field compared to the LIVE value. */
const getPendingForReview = async (branchId: string, memberDbId: string) => {
  const request = await MemberUpdateRequest.findOne({
    branchId: toKey(branchId),
    memberId: toKey(memberDbId),
    status: "pending",
  }).lean();

  if (!request) return null;

  const member = await Member.findOne({
    _id: toKey(memberDbId),
    branchId: toKey(branchId),
  }).lean();
  if (!member) return null;

  const fields = Object.entries((request.changes ?? {}) as TChanges).map(([key, change]) => {
    const live = currentFieldValue(member, key as TRequestFieldKey);
    const alreadyApplied = isSameValue(key as TRequestFieldKey, live, change.new);
    return {
      field: key,
      requested: change.new,
      current: live,
      // what the member saw when asking, shown when it no longer matches the live value
      atRequestTime: change.old,
      kind: alreadyApplied ? "same" : live == null ? "add" : "change",
      changedSinceRequest: !isSameValue(key as TRequestFieldKey, live, change.old),
    };
  });

  return {
    _id: request._id,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    fields,
    photo: request.photo?.newKey
      ? { requested: request.photo.newKey, current: member.photo || null }
      : null,
  };
};

const listPendingMemberIds = async (branchId: string) => {
  const ids = await MemberUpdateRequest.distinct("memberId", {
    branchId: toKey(branchId),
    status: "pending",
  });
  return ids.map(String);
};

/**
 * Staff reviews a request. `accept` lists the field keys (and/or "photo") to apply;
 * everything else is rejected. `overrides` lets staff correct a value before applying.
 */
const review = async (
  branchId: string,
  requestId: string,
  actor: TBranchActor,
  input: { accept: string[]; overrides?: Record<string, unknown>; note?: string },
) => {
  if (!Types.ObjectId.isValid(requestId)) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Invalid request id");
  }

  // Claim it so two reviewers cannot apply the same request twice.
  const request = await MemberUpdateRequest.findOneAndUpdate(
    { _id: toKey(requestId), branchId: toKey(branchId), status: "pending" },
    { $set: { status: "processing" } },
    { returnDocument: "after" },
  );

  if (!request) {
    throw new AppError(
      StatusCodes.CONFLICT,
      "This request was already handled or no longer exists",
    );
  }

  const releaseClaim = () =>
    MemberUpdateRequest.updateOne(
      { _id: request._id, status: "processing" },
      { $set: { status: "pending" } },
    );

  try {
    const changes = (request.changes ?? {}) as TChanges;
    const requestedKeys = Object.keys(changes);
    const acceptSet = new Set(input.accept);

    for (const key of acceptSet) {
      if (key !== "photo" && !requestedKeys.includes(key)) {
        throw new AppError(StatusCodes.BAD_REQUEST, `"${key}" is not part of this request`);
      }
    }

    // Values to apply (staff overrides win), validated with the same rules as the portal.
    const accepted: Record<string, unknown> = {};
    for (const key of requestedKeys) {
      if (acceptSet.has(key)) {
        accepted[key] = input.overrides && key in input.overrides
          ? input.overrides[key]
          : changes[key]!.new;
      }
    }

    const parsed = requestFieldsSchema.safeParse(accepted);
    if (!parsed.success) {
      throw new AppError(
        StatusCodes.BAD_REQUEST,
        parsed.error.issues[0]?.message ?? "Invalid value",
      );
    }

    const payload: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(parsed.data)) {
      Object.assign(payload, toMemberPayload(key as TRequestFieldKey, value));
    }

    const photoKey = request.photo?.newKey;
    const acceptPhoto = Boolean(photoKey) && acceptSet.has("photo");

    if (Object.keys(payload).length || acceptPhoto) {
      await MemberService.updateMember(
        branchId,
        String(request.memberId),
        actor,
        payload as any,
        acceptPhoto ? ({ path: photoKey } as Express.Multer.File) : undefined,
      );
    }

    if (photoKey && !acceptPhoto) {
      await removePhoto(photoKey);
    }

    const resolution: Record<string, "accepted" | "rejected"> = {};
    for (const key of requestedKeys) {
      resolution[key] = acceptSet.has(key) ? "accepted" : "rejected";
    }
    if (photoKey) resolution.photo = acceptPhoto ? "accepted" : "rejected";

    const values = Object.values(resolution);
    const acceptedCount = values.filter((v) => v === "accepted").length;
    const status =
      acceptedCount === 0
        ? "rejected"
        : acceptedCount === values.length
          ? "approved"
          : "partially_approved";

    request.status = status;
    request.set("resolution", resolution);
    request.set(
      "reviewedBy",
      actor.userId
        ? { kind: "owner", id: actor.userId }
        : { kind: "staff", id: (actor.staff as unknown as { _id?: Types.ObjectId })?._id },
    );
    request.reviewedAt = new Date();
    request.reviewNote = input.note?.trim() || undefined;
    await request.save();

    return request.toObject();
  } catch (error) {
    await releaseClaim();
    throw error;
  }
};

export const MemberUpdateRequestService = {
  submit,
  getForMember,
  cancelForMember,
  getPendingForReview,
  listPendingMemberIds,
  review,
};
