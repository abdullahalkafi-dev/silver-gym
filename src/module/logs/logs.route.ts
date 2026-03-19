import { Router } from "express";
import { requireAdminApiKey } from "../../middlewares/adminApiKey";
import { LogsController } from "./logs.controller";

const router = Router();

router.use(requireAdminApiKey);

router.get("/ui", LogsController.getViewer);
router.get("/ui/app.js", LogsController.getViewerScript);
router.get("/", LogsController.getLogs);
router.get("/:category/:fileName", LogsController.getLogPreview);

export const LogsRoutes = router;
