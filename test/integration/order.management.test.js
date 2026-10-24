import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import jwt from "jsonwebtoken";
import request from "supertest";

vi.mock("../../src/services/rateLimit.service.js", () => ({
  checkSlidingWindowLimit: async () => ({
    allowed: true,
    requestCount: 1,
    retryAfterMs: 0,
  }),
}));

import app from "../../src/app.js";
import orderService from "../../src/services/order.service.js";

// Mock orderService
vi.mock("../../src/services/order.service.js", () => ({
  default: {
    updateOrder: vi.fn(),
    updateOrderStatus: vi.fn(),
    getStatusOverview: vi.fn(),
    countTodayOrders: vi.fn(),
    countYesterdayOrders: vi.fn(),
    getStatusRevenue: vi.fn(),
    getAllOrders: vi.fn(),
    getOrdersByUserId: vi.fn(),
    getByOrderCode: vi.fn(),
    markPaymentResultViewed: vi.fn(),
    getPaymentStatus: vi.fn(),
  },
}));

const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || "test-access-token-secret";
process.env.ACCESS_TOKEN_SECRET = ACCESS_TOKEN_SECRET;

const generateToken = (userId, role = "user") => {
  return jwt.sign({ userId, role }, ACCESS_TOKEN_SECRET);
};

describe("Order Management APIs Integration Tests", () => {
  // Test Constants
  const MOCK_USER_ID = 20;
  const MOCK_ADMIN_ID = 1;
  const MOCK_ORDER_ID = 100;
  const MOCK_ORDER_CODE = "DH2026-000099";

  const userToken = generateToken(MOCK_USER_ID, "user");
  const adminToken = generateToken(MOCK_ADMIN_ID, "admin");

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("PATCH /api/orders/:orderId/status", () => {
    it("Scenario 1: returns 200 OK when Admin updates order status to a valid value", async () => {
      orderService.updateOrder.mockResolvedValue({ affectedRows: 1 });

      const res = await request(app)
        .patch(`/api/orders/${MOCK_ORDER_ID}/status`)
        .set("Origin", "http://localhost:3000")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ status: "delivering" });

      expect(res.status).toBe(200);
      expect(res.body.message).toContain("Update order status successful");
      expect(orderService.updateOrder).toHaveBeenCalledWith(
        String(MOCK_ORDER_ID),
        "delivering"
      );
    });

    it("Scenario 2: returns 400 Bad Request when Admin provides an invalid or missing status", async () => {
      const res = await request(app)
        .patch(`/api/orders/${MOCK_ORDER_ID}/status`)
        .set("Origin", "http://localhost:3000")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ status: "invalid_status_xyz" });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("Missing or incorrect status");
      expect(orderService.updateOrder).not.toHaveBeenCalled();
    });

    it("Scenario 3: returns 403 Forbidden when a regular user attempts to update order status", async () => {
      const res = await request(app)
        .patch(`/api/orders/${MOCK_ORDER_ID}/status`)
        .set("Origin", "http://localhost:3000")
        .set("Authorization", `Bearer ${userToken}`)
        .send({ status: "delivered" });

      expect(res.status).toBe(403);
      expect(res.body.message).toContain("You do not have access");
      expect(orderService.updateOrder).not.toHaveBeenCalled();
    });
  });

  describe("Admin Order Management & Overview Stats", () => {
    it("Scenario 4: returns 200 OK and order overview count statistics for Admin (GET /stats/overviewCount)", async () => {
      orderService.countTodayOrders.mockResolvedValue(15);
      orderService.countYesterdayOrders.mockResolvedValue(10);

      const res = await request(app)
        .get("/api/orders/stats/overviewCount")
        .set("Origin", "http://localhost:3000")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("countTodayOrders", 15);
      expect(res.body).toHaveProperty("status");
      expect(res.body).toHaveProperty("percent");
      expect(orderService.countTodayOrders).toHaveBeenCalled();
      expect(orderService.countYesterdayOrders).toHaveBeenCalled();
    });

    it("Scenario 5: returns 200 OK and all system orders for Admin (GET /api/orders/)", async () => {
      const mockAllOrders = [
        { id: 100, orderCode: "DH001", totalPriceOrder: 150000 },
        { id: 101, orderCode: "DH002", totalPriceOrder: 200000 },
      ];
      orderService.getAllOrders.mockResolvedValue(mockAllOrders);

      const res = await request(app)
        .get("/api/orders/")
        .set("Origin", "http://localhost:3000")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ total: 2, orders: mockAllOrders });
      expect(orderService.getAllOrders).toHaveBeenCalled();
    });

    it("Scenario 6: returns 200 OK and all orders of a specific user for Admin (GET /api/orders/user/:userId)", async () => {
      const mockUserOrders = [
        { id: 100, userID: MOCK_USER_ID, totalPriceOrder: 90000 },
      ];
      orderService.getOrdersByUserId.mockResolvedValue(mockUserOrders);

      const res = await request(app)
        .get(`/api/orders/user/${MOCK_USER_ID}`)
        .set("Origin", "http://localhost:3000")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ total: 1, orders: mockUserOrders });
      expect(orderService.getOrdersByUserId).toHaveBeenCalledWith(
        String(MOCK_USER_ID)
      );
    });
  });


  describe("GET /api/orders/payment-status/by-code/:orderCode", () => {
    it("Scenario 7: returns 200 OK and payment status when queried for the first time", async () => {
      const mockOrder = {
        orderId: MOCK_ORDER_ID,
        orderCode: MOCK_ORDER_CODE,
        has_viewed_payment_result: false,
      };

      const mockPaymentDetails = {
        orderId: MOCK_ORDER_ID,
        orderCode: MOCK_ORDER_CODE,
        paymentStatus: "success",
        totalPriceOrder: 90000,
      };

      orderService.getByOrderCode.mockResolvedValue(mockOrder);
      orderService.getPaymentStatus.mockResolvedValue(mockPaymentDetails);

      const res = await request(app)
        .get(`/api/orders/payment-status/by-code/${MOCK_ORDER_CODE}`)
        .set("Origin", "http://localhost:3000");

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockPaymentDetails);
      expect(orderService.markPaymentResultViewed).toHaveBeenCalledWith({
        orderId: MOCK_ORDER_ID,
      });
      expect(orderService.getPaymentStatus).toHaveBeenCalledWith(MOCK_ORDER_ID);
    });

    it("Scenario 8: returns 403 Forbidden when order payment result has already been reviewed", async () => {
      const mockOrderAlreadyViewed = {
        orderId: MOCK_ORDER_ID,
        orderCode: MOCK_ORDER_CODE,
        has_viewed_payment_result: true,
      };

      orderService.getByOrderCode.mockResolvedValue(mockOrderAlreadyViewed);

      const res = await request(app)
        .get(`/api/orders/payment-status/by-code/${MOCK_ORDER_CODE}`)
        .set("Origin", "http://localhost:3000");

      expect(res.status).toBe(403);
      expect(res.body.message).toContain("Payment cannot be reviewed");
      expect(orderService.markPaymentResultViewed).not.toHaveBeenCalled();
      expect(orderService.getPaymentStatus).not.toHaveBeenCalled();
    });

    it("Scenario 9: returns 404 Not Found when order code does not exist in database", async () => {
      orderService.getByOrderCode.mockResolvedValue(null);

      const res = await request(app)
        .get("/api/orders/payment-status/by-code/NON_EXISTENT_CODE")
        .set("Origin", "http://localhost:3000");

      expect(res.status).toBe(404);
      expect(res.body.message).toContain("Order not found");
      expect(orderService.getPaymentStatus).not.toHaveBeenCalled();
    });
  });
});
