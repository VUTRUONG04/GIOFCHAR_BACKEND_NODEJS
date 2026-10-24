import express from "express";
const router = express.Router();

import {
  requireAuth,
  authorizeOrderAccess,
  optionalAuth,
} from "../middlewares/auth.middleware.js";

import orderController from "../controllers/order.controller.js";

import { checkAdmin } from "../middlewares/user.middleware.js";
import { checkOrderByOrderCode } from "../middlewares/order.middleware.js";
import {
  codOrderByIpLimiter,
  paymentStatusByIpLimiter,
} from "../middlewares/rateLimitLimiters.middleware.js";

// Xóa order dành cho admin
router.delete(
  "/:orderId",
  requireAuth,
  checkAdmin,
  orderController.deleteOrder,
);

// Hủy order dành cho user và khách
router.put(
  "/:orderId/cancel",
  optionalAuth,
  authorizeOrderAccess,
  orderController.cancelOrder,
);

// Cập nhật trạng thái order dành cho admin
router.patch(
  "/:orderId/status",
  requireAuth,
  checkAdmin,
  orderController.updateOrderStatus,
);

// Tạo order dành cho user
router.post(
  "/user/cod",
  requireAuth,
  codOrderByIpLimiter,
  orderController.createOrder,
);

// Tạo order dành cho khách
router.post(
  "/guest/cod",
  optionalAuth,
  codOrderByIpLimiter,
  orderController.createOrder,
);

// Xem trạng thái order của hôm nay so với hôm qua
router.get(
  "/stats/overviewCount",
  requireAuth,
  checkAdmin,
  orderController.getStatusOverview,
);

router.get(
  "/stats/overviewRevenue",
  requireAuth,
  checkAdmin,
  orderController.getStatusRevenue,
);

// Xem chi tiết item bên trong orderid có thể là khách, user, admin
router.get(
  "/:orderId/detail",
  optionalAuth,
  authorizeOrderAccess,
  orderController.getOrderItemsByOrderId,
);
router.get(
  "/payment-status/by-code/:orderCode",
  paymentStatusByIpLimiter,
  checkOrderByOrderCode,
  orderController.getPaymentStatus,
);
// Xem tất cả order của chính bản thân dành cho user
router.get(
  "/user/my-orders",
  requireAuth,
  orderController.getOrdersByUserId,
);

// Xem tất cả order của user đó dành cho admin
router.get(
  "/user/:userId",
  requireAuth,
  checkAdmin,
orderController.getOrdersByUserId,
);
router.get("/", requireAuth, checkAdmin, orderController.getAllOrders);

export default router;
