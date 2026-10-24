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

export const guestInitByIpLimiter = createRateLimitMiddleware(
  rateLimitPolicies.guestInitByIp,
);

export const codOrderByIpLimiter = createRateLimitMiddleware(
  rateLimitPolicies.codOrderByIp,
);

export const cartMutationByIpLimiter = createRateLimitMiddleware(
  rateLimitPolicies.cartMutationByIp,
);

export const foodImageUploadByIpLimiter = createRateLimitMiddleware(
  rateLimitPolicies.foodImageUploadByIp,
);

export const paymentStatusByIpLimiter = createRateLimitMiddleware(
  rateLimitPolicies.paymentStatusByIp,
);

export const globalApiLimiter = createRateLimitMiddleware(
  rateLimitPolicies.globalApiByIp,
);
