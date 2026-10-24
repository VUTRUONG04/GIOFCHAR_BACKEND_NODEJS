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
import orderItemService from "../../src/services/order_item.service.js";

vi.mock("../../src/services/order.service.js", () => ({
  default: {
    getOrderByIdAndUser: vi.fn(),
    getOrdersByUserId: vi.fn(),
    cancelOrder: vi.fn(),
    deleteOrder: vi.fn(),
    updateOrderStatus: vi.fn(),
    getStatusOverview: vi.fn(),
    getStatusRevenue: vi.fn(),
    getAllOrders: vi.fn(),
  },
}));

vi.mock("../../src/services/order_item.service.js", () => ({
  default: {
    getOrderItemsByOrderId: vi.fn(),
  },
}));

const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || "test-access-token-secret";
process.env.ACCESS_TOKEN_SECRET = ACCESS_TOKEN_SECRET;

// Helper sinh JWT Token cho các actor khác nhau
const generateToken = (userId, role = "user") => {
  return jwt.sign({ userId, role }, ACCESS_TOKEN_SECRET);
};

describe("Order Authorization & Security Integration Tests", () => {
  // Test Constants
  const USER_A_ID = 20;
  const USER_B_ID = 99;
  const ADMIN_ID = 1;
  const MOCK_ORDER_ID = 100;
  const MOCK_GUEST_TOKEN = "valid-guest-token-uuid-1234";

  const userAToken = generateToken(USER_A_ID, "user");
  const userBToken = generateToken(USER_B_ID, "user");
  const adminToken = generateToken(ADMIN_ID, "admin");

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Resource Ownership (User vs User)", () => {
    it("returns 403 Forbidden when User B tries to view User A's order details", async () => {
      orderService.getOrderByIdAndUser.mockResolvedValue(null); // Giả lập userB dùng userId để tìm order MOCK_ORDER_ID nhưng không tồn tại.

      const res = await request(app)
        .get(`/api/orders/${MOCK_ORDER_ID}/detail`)
        .set("Origin", "http://localhost:3000")
        .set("Authorization", `Bearer ${userBToken}`);

      expect(res.status).toBe(403);
      expect(res.body.message).toContain("You do not have access");
      expect(orderItemService.getOrderItemsByOrderId).not.toHaveBeenCalled();
    });

    it("returns 403 Forbidden when User B tries to cancel User A's order", async () => {
      orderService.getOrderByIdAndUser.mockResolvedValue(null);

      const res = await request(app)
        .put(`/api/orders/${MOCK_ORDER_ID}/cancel`)
        .set("Origin", "http://localhost:3000")
        .set("Authorization", `Bearer ${userBToken}`);

      expect(res.status).toBe(403);
      expect(res.body.message).toContain("You do not have access");
      expect(orderService.cancelOrder).not.toHaveBeenCalled();
    });

    it("returns 200 OK when User A views their own order details", async () => {
      orderService.getOrderByIdAndUser.mockResolvedValue({
        orderId: MOCK_ORDER_ID,
        userId: USER_A_ID,
      });
      orderItemService.getOrderItemsByOrderId.mockResolvedValue([
        { foodName: "Burger", quantity: 2, price: 45000 },
      ]);

      const res = await request(app)
        .get(`/api/orders/${MOCK_ORDER_ID}/detail`)
        .set("Origin", "http://localhost:3000")
        .set("Authorization", `Bearer ${userAToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([
        { foodName: "Burger", quantity: 2, price: 45000 },
      ]);
    });

    it("returns 200 OK when User A fetches their own order list (/user/my-orders)", async () => {
      orderService.getOrdersByUserId.mockResolvedValue([
        { orderId: MOCK_ORDER_ID, userId: USER_A_ID, totalPriceOrder: 90000 },
      ]);

      const res = await request(app)
        .get("/api/orders/user/my-orders")
        .set("Origin", "http://localhost:3000")
        .set("Authorization", `Bearer ${userAToken}`);

      expect(res.status).toBe(200);
      expect(orderService.getOrdersByUserId).toHaveBeenCalledWith(USER_A_ID);
    });
  });

  describe("Guest Token Authorization", () => {
    it("returns 200 OK when Guest presents a valid x-guest-token matching the order", async () => {
      orderService.getOrderByIdAndUser.mockResolvedValue({
        orderId: MOCK_ORDER_ID,
        guestToken: MOCK_GUEST_TOKEN,
      });
      orderItemService.getOrderItemsByOrderId.mockResolvedValue([
        { foodName: "Pizza", quantity: 1, price: 120000 },
      ]);

      const res = await request(app)
        .get(`/api/orders/${MOCK_ORDER_ID}/detail`)
        .set("Origin", "http://localhost:3000")
        .set("x-guest-token", MOCK_GUEST_TOKEN);

      expect(res.status).toBe(200);
      expect(orderService.getOrderByIdAndUser).toHaveBeenCalledWith(
        String(MOCK_ORDER_ID),
        { userId: null, guestToken: MOCK_GUEST_TOKEN }
      );
    });

    it("returns 403 Forbidden when Guest provides an invalid or mismatching x-guest-token", async () => {
      orderService.getOrderByIdAndUser.mockResolvedValue(null);

      const res = await request(app)
        .get(`/api/orders/${MOCK_ORDER_ID}/detail`)
        .set("Origin", "http://localhost:3000")
        .set("x-guest-token", "invalid-guest-token");

      expect(res.status).toBe(403);
      expect(res.body.message).toContain("You do not have access");
    });

    it("returns 403 Forbidden when logged-in User A presents x-guest-token to access a guest order", async () => {
      orderService.getOrderByIdAndUser.mockResolvedValue(null);

      const res = await request(app)
        .get(`/api/orders/${MOCK_ORDER_ID}/detail`)
        .set("Origin", "http://localhost:3000")
        .set("Authorization", `Bearer ${userAToken}`)
        .set("x-guest-token", MOCK_GUEST_TOKEN);

      expect(res.status).toBe(403);
      expect(res.body.message).toContain("You do not have access");
      expect(orderService.getOrderByIdAndUser).toHaveBeenCalledWith(
        String(MOCK_ORDER_ID),
        { userId: USER_A_ID, guestToken: null }
      );
    });
  });

  describe("Admin Role-Based Access Control (RBAC & Admin Bypass)", () => {
    it("returns 200 OK and bypasses ownership check when Admin views any user's order", async () => {
      orderItemService.getOrderItemsByOrderId.mockResolvedValue([
        { foodName: "Burger", quantity: 2, price: 45000 },
      ]);

      const res = await request(app)
        .get(`/api/orders/${MOCK_ORDER_ID}/detail`)
        .set("Origin", "http://localhost:3000")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      // Admin bypass: getOrderByIdAndUser không cần được gọi
      expect(orderService.getOrderByIdAndUser).not.toHaveBeenCalled();
      expect(orderItemService.getOrderItemsByOrderId).toHaveBeenCalledWith(String(MOCK_ORDER_ID));
    });

    it("returns 403 Forbidden when regular User A tries to access Admin-only Revenue Stats (/stats/overviewRevenue)", async () => {
      const res = await request(app)
        .get("/api/orders/stats/overviewRevenue")
        .set("Origin", "http://localhost:3000")
        .set("Authorization", `Bearer ${userAToken}`);

      expect(res.status).toBe(403);
      expect(res.body.message).toContain("You do not have access");
      expect(orderService.getStatusRevenue).not.toHaveBeenCalled();
    });

    it("returns 403 Forbidden when regular User A tries to delete an order (DELETE /:orderId)", async () => {
      const res = await request(app)
        .delete(`/api/orders/${MOCK_ORDER_ID}`)
        .set("Origin", "http://localhost:3000")
        .set("Authorization", `Bearer ${userAToken}`);

      expect(res.status).toBe(403);
      expect(res.body.message).toContain("You do not have access");
      expect(orderService.deleteOrder).not.toHaveBeenCalled();
    });

    it("returns 200 OK when Admin deletes an order (DELETE /:orderId)", async () => {
      orderService.deleteOrder.mockResolvedValue({ affectedRows: 1 });

      const res = await request(app)
        .delete(`/api/orders/${MOCK_ORDER_ID}`)
        .set("Origin", "http://localhost:3000")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(orderService.deleteOrder).toHaveBeenCalledWith(String(MOCK_ORDER_ID));
    });
  });

  describe("Unauthenticated Access Protection", () => {
    it("returns 401 Unauthorized when accessing requireAuth endpoint without token", async () => {
      const res = await request(app)
        .get("/api/orders/user/my-orders")
        .set("Origin", "http://localhost:3000");

      expect(res.status).toBe(401);
      expect(res.body.message).toContain("Access token missing");
      expect(orderService.getOrdersByUserId).not.toHaveBeenCalled();
    });
  });
});
