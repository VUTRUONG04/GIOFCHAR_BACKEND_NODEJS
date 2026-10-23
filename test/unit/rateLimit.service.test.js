import { beforeEach, describe, expect, it, vi } from "vitest";

const { evalMock } = vi.hoisted(() => ({
  evalMock: vi.fn(),
}));

vi.mock("../../src/config/redis.js", () => ({
  default: {
    isReady: true,
    eval: evalMock,
  },
}));

import { checkSlidingWindowLimit } from "../../src/services/rateLimit.service.js";

describe("checkSlidingWindowLimit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("executes the sliding-window script with the supplied configuration", async () => {
    evalMock.mockResolvedValue([0, 3, 0]);

    const result = await checkSlidingWindowLimit({
      key: "rate_limit:login:ip:127.0.0.1",
      windowMs: 60_000,
      maxRequests: 5,
      requestId: "unique-request-member",
    });

    expect(evalMock).toHaveBeenCalledWith(expect.any(String), {
      keys: ["rate_limit:login:ip:127.0.0.1"],
      arguments: [
        expect.stringMatching(/^\d+$/),
        "60000",
        "5",
        "unique-request-member",
      ],
    });
    expect(result).toEqual({
      allowed: true,
      requestCount: 3,
      retryAfterMs: 0,
    });
  });

  it("rejects invalid sliding-window configuration before accessing Redis", async () => {
    await expect(
      checkSlidingWindowLimit({
        key: "rate_limit:test",
        windowMs: 60_000,
        maxRequests: 0,
        requestId: "unique-request-member",
      }),
    ).rejects.toThrow("Invalid sliding window rate-limit configuration");

    expect(evalMock).not.toHaveBeenCalled();
  });
});
