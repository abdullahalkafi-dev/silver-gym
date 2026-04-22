import { Router } from "express";

import authStaff from "@middlewares/authStaff";
import requirePermission from "@middlewares/requirePermission";
import { authLimiter } from "@middlewares/security";
import validateRequest from "@middlewares/validateRequest";
import { PaymentController } from "./payment.controller";
import { PaymentDto } from "./payment.dto";

const router = Router();

/**
 * @route   POST /api/v1/payments/:branchId
 * @desc    Create a new payment
 * @access  Private (Owner or Staff with canAddPayment)
 */
router.post(
  "/:branchId",
  authLimiter,
  authStaff({ allowOwner: true }),
  requirePermission("canAddPayment"),
  validateRequest(PaymentDto.create),
  PaymentController.create,
);

/**
 * @route   GET /api/v1/payments/:branchId
 * @desc    Get payments list for a branch
 * @access  Private (Owner or Staff with canViewPayments)
 */
router.get(
  "/:branchId",
  authStaff({ allowOwner: true }),
  requirePermission("canViewPayments"),
  validateRequest(PaymentDto.query),
  PaymentController.getAll,
);

/**
 * @route   GET /api/v1/payments/:branchId/collect-bill/:memberId
 * @desc    Get collect bill context for a member
 * @access  Private (Owner or Staff with canAddPayment)
 */
router.get(
  "/:branchId/collect-bill/:memberId",
  authStaff({ allowOwner: true }),
  requirePermission("canAddPayment"),
  validateRequest(PaymentDto.collectBillContext),
  PaymentController.getCollectBillContext,
);

/**
 * @route   POST /api/v1/payments/:branchId/collect-bill
 * @desc    Collect a member bill and update membership atomically
 * @access  Private (Owner or Staff with canAddPayment)
 */
router.post(
  "/:branchId/collect-bill",
  authLimiter,
  authStaff({ allowOwner: true }),
  requirePermission("canAddPayment"),
  validateRequest(PaymentDto.collectBill),
  PaymentController.collectBill,
);

/**
 * @route   GET /api/v1/payments/:branchId/:paymentId
 * @desc    Get a single payment by ID
 * @access  Private (Owner or Staff with canViewPayments)
 */
router.get(
  "/:branchId/:paymentId",
  authStaff({ allowOwner: true }),
  requirePermission("canViewPayments"),
  PaymentController.getById,
);

/**
 * @route   PATCH /api/v1/payments/:branchId/:paymentId
 * @desc    Update payment details
 * @access  Private (Owner or Staff with canEditPayment)
 */
router.patch(
  "/:branchId/:paymentId",
  authLimiter,
  authStaff({ allowOwner: true }),
  requirePermission("canEditPayment"),
  validateRequest(PaymentDto.update),
  PaymentController.update,
);

/**
 * @route   PATCH /api/v1/payments/:branchId/:paymentId/cancel
 * @desc    Cancel a payment
 * @access  Private (Owner or Staff with canDeletePayment)
 */
router.patch(
  "/:branchId/:paymentId/cancel",
  authLimiter,
  authStaff({ allowOwner: true }),
  requirePermission("canDeletePayment"),
  PaymentController.cancel,
);

/**
 * @route   PATCH /api/v1/payments/:branchId/:paymentId/refund
 * @desc    Refund a payment
 * @access  Private (Owner or Staff with canRefundPayment)
 */
router.patch(
  "/:branchId/:paymentId/refund",
  authLimiter,
  authStaff({ allowOwner: true }),
  requirePermission("canRefundPayment"),
  PaymentController.refund,
);

export default router;
