import { NextFunction, Request, Response } from "express";
import { StatusCodes } from "http-status-codes";

import config from "../../config";
import AppError from "../../errors/AppError";
import { createJwtToken, verifyJwtToken } from "../../jwt";
import { Member } from "../member/member.model";
import { Trainer } from "../trainer/trainer.model";

export type TPortalAuth =
  | { kind: "member"; memberDbId: string; branchId: string }
  | { kind: "trainer"; trainerId: string; branchId: string };

declare global {
  namespace Express {
    interface Request {
      portal?: TPortalAuth;
    }
  }
}

// A different signing secret than the dashboard: a portal token can never be
// accepted by dashboard routes, and a dashboard token never by the portal.
const portalSecret = () => `${config.jwt.jwt_secret}.portal`;

export const signPortalToken = (auth: TPortalAuth) =>
  createJwtToken(
    { tokenType: "portal", ...auth },
    portalSecret(),
    config.jwt.jwt_expire_in || "7d",
  );

const unauthorized = () => new AppError(StatusCodes.UNAUTHORIZED, "Please sign in again");

/** Verifies the portal token and that the member/trainer is still active. */
const authPortal =
  (kind?: "member" | "trainer") =>
  async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const header = req.headers.authorization;
      if (!header?.startsWith("Bearer ")) throw unauthorized();

      let decoded: any;
      try {
        decoded = verifyJwtToken(header.split(" ")[1] ?? "", portalSecret());
      } catch {
        throw unauthorized();
      }

      if (decoded?.tokenType !== "portal") throw unauthorized();
      if (kind && decoded.kind !== kind) throw unauthorized();

      if (decoded.kind === "member") {
        const member = await Member.findOne({
          _id: decoded.memberDbId,
          isActive: true,
        })
          .select("_id branchId")
          .lean();
        if (!member) throw unauthorized();
        req.portal = {
          kind: "member",
          memberDbId: String(member._id),
          branchId: String(member.branchId),
        };
      } else if (decoded.kind === "trainer") {
        const trainer = await Trainer.findOne({ _id: decoded.trainerId, isActive: true })
          .select("_id branchId")
          .lean();
        if (!trainer) throw unauthorized();
        req.portal = {
          kind: "trainer",
          trainerId: String(trainer._id),
          branchId: String(trainer.branchId),
        };
      } else {
        throw unauthorized();
      }

      next();
    } catch (error) {
      next(error);
    }
  };

export default authPortal;
