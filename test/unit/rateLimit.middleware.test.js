import { beforeEach, describe, expect, it, vi } from "vitest";

const { checkSlidingWindowLimit } = vi.hoisted(() => ({
  checkSlidingWindowLimit: vi.fn(),
}));

vi.mock("../../src/services/rateLimit.service.js", () => ({
  checkSlidingWindowLimit,
}));

import { createRateLimitMiddleware } from "../../src/middlewares/rateLimit.middleware.js";

describe("createRateLimitMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkSlidingWindowLimit.mockResolvedValue({
      allowed: true,
      requestCount: 1,
      retryAfterMs: 0,
    });
  });

  it("uses a unique server-generated member for each request", async () => {
    const middleware = createRateLimitMiddleware({
      keyPrefix: "login:ip",
      windowMs: 60_000,
      maxCountRequest: 5,
      keyGenerator: () => "127.0.0.1",
    });

    const req = { requestId: "client-controlled-id" };
    const next = vi.fn();

    await middleware(req, {}, next);
    await middleware(req, {}, next);

    const firstCall = checkSlidingWindowLimit.mock.calls[0][0];
    const secondCall = checkSlidingWindowLimit.mock.calls[1][0];

    expect(firstCall).toEqual({
      key: "rate_limit:login:ip:127.0.0.1",
      windowMs: 60_000,
      maxRequests: 5,
      requestId: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      ),
    });
    expect(secondCall.requestId).not.toBe(firstCall.requestId);
    expect(firstCall.requestId).not.toBe(req.requestId);
    expect(next).toHaveBeenCalledTimes(2);
  });

  it("returns 429 and Retry-After when the limit is exceeded", async () => {
    checkSlidingWindowLimit.mockResolvedValue({
      allowed: false,
      requestCount: 5,
      retryAfterMs: 1_500,
    });
    const middleware = createRateLimitMiddleware({
      keyPrefix: "login:ip",
      windowMs: 60_000,
      maxCountRequest: 5,
      keyGenerator: () => "127.0.0.1",
    });
    const res = {
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    const next = vi.fn();

    await middleware({}, res, next);

    expect(res.setHeader).toHaveBeenCalledWith("Retry-After", "2");
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith({
      message: "Too many requests",
      code: "RATE_LIMIT_EXCEEDED",
      requestCount: 5,
    });
    expect(next).not.toHaveBeenCalled();
  });
});
