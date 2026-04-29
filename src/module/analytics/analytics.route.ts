import { Router } from "express";

import authStaff from "@middlewares/authStaff";
import requirePermission from "@middlewares/requirePermission";
import validateRequest from "@middlewares/validateRequest";
import { AnalyticsController } from "./analytics.controller";
import { AnalyticsDto } from "./analytics.dto";

const router = Router();

/**
 * @route   GET /api/v1/analytics/:branchId/member-summary
 * @desc    Get member analytics summary for a branch
 * @access  Private (Owner or Staff with canViewAnalytics)
 */
router.get(
  "/:branchId/member-summary",
  authStaff({ allowOwner: true }),
  requirePermission("canViewAnalytics"),
  validateRequest(AnalyticsDto.memberSummary),
  AnalyticsController.getMemberSummary,
);

/**
 * @route   GET /api/v1/analytics/:branchId/financial
 * @desc    Get financial analytics for a branch
 * @access  Private (Owner or Staff with canViewAnalytics)
 */
router.get(
  "/:branchId/financial",
  authStaff({ allowOwner: true }),
  requirePermission("canViewAnalytics"),
  validateRequest(AnalyticsDto.financial),
  AnalyticsController.getFinancialSummary,
);

/**
 * @route   GET /api/v1/analytics/:branchId/cost
 * @desc    Get expense cost breakdown analytics
 * @access  Private (Owner or Staff with canViewAnalytics)
 */
router.get(
  "/:branchId/cost",
  authStaff({ allowOwner: true }),
  requirePermission("canViewAnalytics"),
  validateRequest(AnalyticsDto.cost),
  AnalyticsController.getCostSummary,
);

/**
 * @route   GET /api/v1/analytics/:branchId/packages
 * @desc    Get package analytics for a branch
 * @access  Private (Owner or Staff with canViewAnalytics)
 */
router.get(
  "/:branchId/packages",
  authStaff({ allowOwner: true }),
  requirePermission("canViewAnalytics"),
  validateRequest(AnalyticsDto.packages),
  AnalyticsController.getPackagesSummary,
);

/**
 * @route   GET /api/v1/analytics/:branchId/compare
 * @desc    Get multi-year compare analytics
 * @access  Private (Owner or Staff with canViewAnalytics)
 */
router.get(
  "/:branchId/compare",
  authStaff({ allowOwner: true }),
  requirePermission("canViewAnalytics"),
  validateRequest(AnalyticsDto.compare),
  AnalyticsController.getCompareSummary,
);

/**
 * @route   GET /api/v1/analytics/:branchId/overview
 * @desc    Get overview dashboard analytics data
 * @access  Private (Owner or Staff with canViewAnalytics)
 */
router.get(
  "/:branchId/overview",
  authStaff({ allowOwner: true }),
  requirePermission("canViewAnalytics"),
  validateRequest(AnalyticsDto.overview),
  AnalyticsController.getOverviewSummary,
);

export const AnalyticsRoutes = router;
