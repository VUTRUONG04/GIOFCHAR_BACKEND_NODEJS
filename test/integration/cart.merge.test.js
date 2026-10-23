import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";

import app from "../../src/app.js";
import authService from "../../src/services/auth.service.js";
import cartService from "../../src/services/cart.service.js";
import { checkSlidingWindowLimit } from "../../src/services/rateLimit.service.js";

vi.mock("../../src/services/rateLimit.service.js", () => ({
  checkSlidingWindowLimit: vi.fn().mockResolvedValue({
    allowed: true,
    requestCount: 1,
    retryAfterMs: 0,
  }),
}));

vi.mock("../../src/services/auth.service.js", () => ({
  default: {
    login: vi.fn(),
  },
}));

vi.mock("../../src/services/cart.service.js", () => ({
  default: {
    mergeGuestCartToUser: vi.fn(),
  },
}));

describe("POST /api/auth/login (Cart Merge Integration Tests)", () => {
  const MOCK_EMAIL = "user20@example.com";
  const MOCK_PASSWORD = "Password123!";
  const MOCK_GUEST_TOKEN = "guest-token-uuid-5678";

  beforeEach(() => {
    vi.clearAllMocks();
    checkSlidingWindowLimit.mockResolvedValue({
      allowed: true,
      requestCount: 1,
      retryAfterMs: 0,
    });
    vi.stubEnv("RATE_LIMIT_HASH_SECRET", "test-rate-limit-hash-secret");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("returns 200 OK and mergeCart: 'success' when login is valid and guestToken is provided", async () => {
    authService.login.mockResolvedValue({
      access_token: "mock-access-token",
      refresh_token: "mock-refresh-token",
      user: { id: 20, userName: "Test User", email: MOCK_EMAIL },
      mergeStatus: true,
    });

    const res = await request(app)
      .post("/api/auth/login")
      .set("Origin", "http://localhost:3000")
      .set("x-guest-token", MOCK_GUEST_TOKEN)
      .send({ email: MOCK_EMAIL, password: MOCK_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      message: "Login successful",
      data: {
        access_token: "mock-access-token",
        user: { id: 20, userName: "Test User", email: MOCK_EMAIL },
        mergeCart: "success",
      },
    });

    expect(authService.login).toHaveBeenCalledWith(
      MOCK_EMAIL,
      MOCK_PASSWORD,
      MOCK_GUEST_TOKEN,
    );
  });

  it("returns 200 OK and mergeCart: 'failed' when cart merge process returns false", async () => {
    authService.login.mockResolvedValue({
      access_token: "mock-access-token",
      refresh_token: "mock-refresh-token",
      user: { id: 20, userName: "Test User", email: MOCK_EMAIL },
      mergeStatus: false,
    });

    const res = await request(app)
      .post("/api/auth/login")
      .set("Origin", "http://localhost:3000")
      .set("x-guest-token", MOCK_GUEST_TOKEN)
      .send({ email: MOCK_EMAIL, password: MOCK_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.data.mergeCart).toBe("failed");
  });
});
