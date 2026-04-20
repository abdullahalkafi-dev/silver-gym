import { StatusCodes } from "http-status-codes";
import { Request, Response } from "express";
import catchAsync from "../../shared/catchAsync";
import sendResponse from "../../shared/sendResponse";
import { LogsService } from "./logs.service";

const getKeyQueryFromRequest = (req: Request): string => {
  const candidates: Array<[string, unknown]> = [
    ["adminKey", req.query.adminKey],
    ["apiKey", req.query.apiKey],
    ["key", req.query.key],
    ["token", req.query.token],
  ];

  for (const [name, value] of candidates) {
    if (typeof value === "string" && value.trim()) {
      const encodedName = encodeURIComponent(name);
      const encodedValue = encodeURIComponent(value.trim());
      return `${encodedName}=${encodedValue}`;
    }
  }

  return "";
};

const getLogs = catchAsync(async (req, res) => {
  const result = await LogsService.getAvailableLogs(
    req.query.category as string | undefined,
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Logs fetched successfully",
    data: result,
  });
});

const getLogPreview = catchAsync(async (req, res) => {
  const category = String(req.params.category || "");
  const fileName = String(req.params.fileName || "");

  const result = await LogsService.getLogFilePreview({
    category,
    fileName,
    lines: req.query.lines,
    maxBytes: req.query.maxBytes,
  });

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Log preview fetched successfully",
    data: result,
  });
});

const getViewer = (req: Request, res: Response) => {
  const keyQuery = getKeyQueryFromRequest(req);
  const scriptSrc = keyQuery
    ? `/api/v1/logs/ui/app.js?${keyQuery}`
    : "/api/v1/logs/ui/app.js";

  res.status(StatusCodes.OK).type("html").send(LogsService.getLogsViewerHtml(scriptSrc));
};

const getViewerScript = (_req: Request, res: Response) => {
  res
    .status(StatusCodes.OK)
    .type("application/javascript")
    .send(LogsService.getLogsViewerScript());
};

export const LogsController = {
  getLogs,
  getLogPreview,
  getViewer,
  getViewerScript,
};
