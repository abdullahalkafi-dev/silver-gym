import { NextFunction, Request, Response } from "express";
import { ZodObject } from "zod";

const validateRequest =
  (schema: ZodObject) =>
  async (req: Request, _res: Response, next: NextFunction) => {
    // Parse req.body.data if it's a string
    if (req.body?.data && typeof req.body.data === "string") {
      try {
        req.body.data = JSON.parse(req.body.data);
      } catch {
        return next(new Error("Invalid JSON in data field"));
      }
    }

    try {
      const parsed = await schema.parseAsync({
        body: req.body,
        params: req.params,
        query: req.query,
        cookies: req.cookies,
        data: req.body?.data,
      });

      // Write Zod-coerced values back so downstream handlers receive proper types
      // (e.g. z.coerce.date() fields become Date instances instead of raw strings)
      if (parsed && typeof parsed === "object") {
        const result = parsed as Record<string, unknown>;
        if ("data" in result && req.body) {
          req.body.data = result.data;
        }
        if ("query" in result && req.query) {
          Object.assign(req.query, result.query);
        }
      }

      next();
    } catch (error) {
      next(error);
    }
  };
export default validateRequest;
