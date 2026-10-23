import { randomUUID } from "node:crypto";
import { checkSlidingWindowLimit } from "../services/rateLimit.service.js";

export function createRateLimitMiddleware({
  keyPrefix,
  windowMs,
  maxCountRequest,
  keyGenerator,
}) {
  return async (req, res, next) => {
    try {
      const identifier = keyGenerator(req);

      if (typeof identifier !== "string" || identifier.trim() === "") {
        return next(new Error("Rate limit identifier is missing or invalid"));
      }

      const key = `rate_limit:${keyPrefix}:${identifier}`;
      const requestId = randomUUID();

      const { allowed, requestCount, retryAfterMs } =
        await checkSlidingWindowLimit({
          key,
          windowMs,
          maxRequests: maxCountRequest,
          requestId,
        });

      if (!allowed) {
        res.setHeader("Retry-After", String(Math.ceil(retryAfterMs / 1000)));

        return res.status(429).json({
          message: "Too many requests",
          code: "RATE_LIMIT_EXCEEDED",
          requestCount,
        });
      }

      return next();
    } catch (error) {
      return next(error);
    }
  };
}
