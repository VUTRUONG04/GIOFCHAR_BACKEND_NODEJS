import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import jwt from "jsonwebtoken";
import request from "supertest";

import app from "../../src/app.js";
import cartService from "../../src/services/cart.service.js";
import orderService from "../../src/services/order.service.js";
import { checkSlidingWindowLimit } from "../../src/services/rateLimit.service.js";

// Mock các Service để cô lập tầng Route/Controller/Middleware
vi.mock("../../src/services/rateLimit.service.js", () => ({
    checkSlidingWindowLimit: vi.fn().mockResolvedValue({
        allowed: true,
        requestCount: 1,
        retryAfterMs: 0,
    }),
}));

vi.mock("../../src/services/cart.service.js", () => ({
    default: {
        withCart: vi.fn(),
    },
}));

vi.mock("../../src/services/order.service.js", () => ({
    default: {
        checkout: vi.fn(),
    },
}));

const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || "test-access-token-secret";
process.env.ACCESS_TOKEN_SECRET = ACCESS_TOKEN_SECRET;

// Helper sinh JWT token hợp lệ
const generateToken = (userId, role = "user") => {
    return jwt.sign({ userId, role }, ACCESS_TOKEN_SECRET);
};

describe("POST /api/orders/user/cod (Checkout Integration using Supertest)", () => {
    const MOCK_USER_ID = 20;
    const MOCK_CART_ID = 1;
    const MOCK_CART_VERSION = 1;
    const MOCK_ORDER_ID = 99;
    const MOCK_ORDER_CODE = "DH2026-000099";
    const MOCK_TOTAL_PRICE = 90000;
    const MOCK_PAYMENT_ID = 202;

    const MOCK_CUSTOMER_INFO = {
        customerName: "Nguyen Van A",
        email: "a@example.com",
        phone: "0900000000",
        address: "Ho Chi Minh City",
        paymentMethod: "COD",
    };

    beforeEach(() => {
        vi.clearAllMocks();
        checkSlidingWindowLimit.mockResolvedValue({
            allowed: true,
            requestCount: 1,
            retryAfterMs: 0,
        });
        
        // Mặc định cho withCart thực thi callback handler truyền vào
        cartService.withCart.mockImplementation(async (context, handler, options) => {
            return await handler({ 
                cartId: MOCK_CART_ID, 
                conn: {}, 
                cartVersion: MOCK_CART_VERSION 
            });
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("returns 200 and successful order details for valid user COD request", async () => {
        const token = generateToken(MOCK_USER_ID, "user");
        const body = {
            cartVersion: MOCK_CART_VERSION,
            ...MOCK_CUSTOMER_INFO,
        };

        // Giả lập checkout trả về kết quả thành công
        orderService.checkout.mockResolvedValue({
            orderId: MOCK_ORDER_ID,
            orderCode: MOCK_ORDER_CODE,
            totalPriceOrder: MOCK_TOTAL_PRICE,
            paymentUrl: "",
            paymentId: MOCK_PAYMENT_ID,
            paymentStatus: "pending",
        });

        // Sử dụng supertest để thực thi request thông qua app Express
        const res = await request(app)
            .post("/api/orders/user/cod")
            .set("Origin", "http://localhost:3000") // Vượt qua middleware checkOrigin
            .set("Authorization", `Bearer ${token}`) // Vượt qua middleware requireAuth
            .send(body);

        expect(res.status).toBe(200);
        expect(res.body).toEqual({
            message: "Create order successful",
            orderId: MOCK_ORDER_ID,
            orderCode: MOCK_ORDER_CODE,
            totalPriceOrder: MOCK_TOTAL_PRICE,
            paymentUrl: "",
        });
    });

    it("returns 401 when Authorization header is missing", async () => {
        const body = {
            cartVersion: MOCK_CART_VERSION,
            ...MOCK_CUSTOMER_INFO,
        };

        const res = await request(app)
            .post("/api/orders/user/cod")
            .set("Origin", "http://localhost:3000")
            .send(body); // Không truyền Authorization Header

        expect(res.status).toBe(401);
        expect(res.body.message).toContain("Access token missing");
    });

    it("returns 400 when required payload fields are missing", async () => {
        const token = generateToken(MOCK_USER_ID, "user");
        const body = {
            cartVersion: MOCK_CART_VERSION,
            customerName: "Nguyen Van A",
            email: "a@example.com",
            // Thiếu phone và address để kích hoạt lỗi Missing Field
            paymentMethod: "COD",
        };

        const res = await request(app)
            .post("/api/orders/user/cod")
            .set("Origin", "http://localhost:3000")
            .set("Authorization", `Bearer ${token}`)
            .send(body);

        expect(res.status).toBe(400);
        expect(res.body.message).toContain("Missing field");
    });

    it("returns 409 Conflict when cart version has changed on server", async () => {
        const token = generateToken(MOCK_USER_ID, "user");
        const body = {
            cartVersion: MOCK_CART_VERSION + 1, // Lệch với server version (cartVersion: 1)
            ...MOCK_CUSTOMER_INFO,
        };

        const res = await request(app)
            .post("/api/orders/user/cod")
            .set("Origin", "http://localhost:3000")
            .set("Authorization", `Bearer ${token}`)
            .send(body);

        expect(res.status).toBe(409);
        expect(res.body.message).toContain("CART_CHANGED");
    });
});
