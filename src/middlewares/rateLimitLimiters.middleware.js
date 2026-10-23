import { rateLimitPolicies } from "../config/rateLimit.js";
import { createRateLimitMiddleware } from "./rateLimit.middleware.js";

export const loginByIpLimiter = createRateLimitMiddleware(
  rateLimitPolicies.loginByIp,
);

export const loginByEmailLimiter = createRateLimitMiddleware(
  rateLimitPolicies.loginByEmail,
);

export const registerByIpLimiter = createRateLimitMiddleware(
  rateLimitPolicies.registerByIp,
);
