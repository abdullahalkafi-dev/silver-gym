import { NextFunction, Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { Secret } from "jsonwebtoken";
import config from "../config";

import AppError from "../errors/AppError";
import { verifyJwtToken } from "jwt";
import { UserRepository } from "module/user/user.repository";
import cacheService from "../redis/cacheService";

const AUTH_CACHE_TTL = 60; // 60 seconds

const auth =
  (...roles: string[]) =>
  async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const tokenWithBearer = req.headers.authorization;

      if (!tokenWithBearer) {
        throw new AppError(StatusCodes.UNAUTHORIZED, "You are not authorized");
      }

      if (!tokenWithBearer.startsWith("Bearer ")) {
        throw new AppError(StatusCodes.UNAUTHORIZED, "You are not authorized");
      }

      const token = tokenWithBearer.split(" ")[1];

      if (!token) {
        throw new AppError(StatusCodes.UNAUTHORIZED, "You are not authorized");
      }

      //verify token
      const verifyUser = verifyJwtToken(
        token,
        config.jwt.jwt_secret as Secret,
      );

      // Try cache first, fallback to DB
      const cacheKey = `auth:user:${verifyUser._id}`;
      let user = await cacheService.getCache<any>(cacheKey);

      if (!user) {
        user = await UserRepository.findById(verifyUser._id);
        if (user) {
          // Cache as plain object (lean-compatible)
          const userObj = user.toObject ? user.toObject() : { ...user };
          await cacheService.setCache(cacheKey, userObj, AUTH_CACHE_TTL);
        }
      }

      if (!user) {
        throw new AppError(
          StatusCodes.UNAUTHORIZED,
          "You are not authorized",
        );
      }
      //check if user is active
      if (user.status !== "active") {
        throw new AppError(
          StatusCodes.UNAUTHORIZED,
          "You account does not exist or is not active",
        );
      }

      //set user to header
      req.user = user;

      user.isSuperAdmin ? (verifyUser.role = "superAdmin") : (verifyUser.role = "user");

      //guard user
      if (roles.length && !roles.includes(verifyUser.role)) {
        throw new AppError(
          StatusCodes.FORBIDDEN,
          "You don't have permission to access this api",
        );
      }

      next();
    } catch (error) {
      next(error);
    }
  };

export default auth;
