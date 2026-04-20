import { Router } from "express";
import { requireAdminApiKey } from "../../middlewares/adminApiKey";
import { LogsController } from "./logs.controller";

const router = Router();

router.use(requireAdminApiKey);

/**
 * @route   GET /api/v1/logs/ui
 * @desc    Get browser-based log viewer page
 * @access  Admin API Key
 */
router.get("/ui", LogsController.getViewer);

/**
 * @route   GET /api/v1/logs/ui/app.js
 * @desc    Get client script for the log viewer page
 * @access  Admin API Key
 */
router.get("/ui/app.js", LogsController.getViewerScript);

/**
 * @route   GET /api/v1/logs
 * @desc    List available log files by category
 * @access  Admin API Key
 */
router.get("/", LogsController.getLogs);

/**
 * @route   GET /api/v1/logs/:category/:fileName
 * @desc    Get tail preview content for a specific log file
 * @access  Admin API Key
 */
router.get("/:category/:fileName", LogsController.getLogPreview);

export const LogsRoutes = router;
