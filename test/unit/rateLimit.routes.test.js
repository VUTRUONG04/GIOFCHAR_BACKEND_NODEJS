import { describe, expect, it } from "vitest";

import { rateLimitPolicies } from "../../src/config/rateLimit.js";
import {
  cartMutationByIpLimiter,
  codOrderByIpLimiter,
  foodImageUploadByIpLimiter,
  guestInitByIpLimiter,
  paymentStatusByIpLimiter,
} from "../../src/middlewares/rateLimitLimiters.middleware.js";
import { optionalAuth, requireAuth } from "../../src/middlewares/auth.middleware.js";
import { checkAdmin } from "../../src/middlewares/user.middleware.js";
import { checkOrderByOrderCode } from "../../src/middlewares/order.middleware.js";
import cartRoutes from "../../src/routes/cart.route.js";
import foodRoutes from "../../src/routes/food.route.js";
import guestRoutes from "../../src/routes/guest.route.js";
import orderRoutes from "../../src/routes/order.route.js";

function getRoute(router, method, path) {
  const routeLayer = router.stack.find(
    (layer) =>
      layer.route?.path === path &&
      layer.route.methods[method],
  );

  expect(routeLayer).toBeDefined();
  return routeLayer.route.stack.map((layer) => layer.handle);
}

function expectLimiterAfter(router, method, path, limiter, previousMiddleware) {
  const handlers = getRoute(router, method, path);
  const limiterIndex = handlers.indexOf(limiter);

  expect(limiterIndex).toBeGreaterThan(0);
  expect(handlers[limiterIndex - 1]).toBe(previousMiddleware);
}

describe("endpoint rate-limit policies", () => {
  it("uses the agreed IP limits", () => {
    expect(rateLimitPolicies.guestInitByIp).toMatchObject({
      keyPrefix: "guest:init:ip",
      windowMs: 60 * 60 * 1000,
      maxCountRequest: 15,
    });
    expect(rateLimitPolicies.codOrderByIp).toMatchObject({
      keyPrefix: "order:cod:ip",
      windowMs: 15 * 60 * 1000,
      maxCountRequest: 10,
    });
    expect(rateLimitPolicies.cartMutationByIp).toMatchObject({
      keyPrefix: "cart:mutation:ip",
      windowMs: 60 * 1000,
      maxCountRequest: 60,
    });
    expect(rateLimitPolicies.foodImageUploadByIp).toMatchObject({
      keyPrefix: "food:image-upload:ip",
      windowMs: 60 * 60 * 1000,
      maxCountRequest: 20,
    });
    expect(rateLimitPolicies.paymentStatusByIp).toMatchObject({
      keyPrefix: "order:payment-status:ip",
      windowMs: 60 * 1000,
      maxCountRequest: 30,
    });

    for (const policy of Object.values(rateLimitPolicies).filter((policy) =>
      [
        "guest:init:ip",
        "order:cod:ip",
        "cart:mutation:ip",
        "food:image-upload:ip",
        "order:payment-status:ip",
      ].includes(policy.keyPrefix),
    )) {
      expect(policy.keyGenerator({ ip: "127.0.0.1" })).toBe("127.0.0.1");
    }
  });

  it("limits guest initialization by IP", () => {
    const handlers = getRoute(guestRoutes, "post", "/init");

    expect(handlers[0]).toBe(guestInitByIpLimiter);
  });

  it("limits both COD order routes after authentication", () => {
    expectLimiterAfter(
      orderRoutes,
      "post",
      "/user/cod",
      codOrderByIpLimiter,
      requireAuth,
    );
    expectLimiterAfter(
      orderRoutes,
      "post",
      "/guest/cod",
      codOrderByIpLimiter,
      optionalAuth,
    );
  });

  it("limits all requested cart mutations after optional authentication", () => {
    for (const path of ["/cartItem", "/", "/:cartItemId"]) {
      const method = path === "/cartItem" ? "post" : "delete";
      expectLimiterAfter(
        cartRoutes,
        method,
        path,
        cartMutationByIpLimiter,
        optionalAuth,
      );
    }
  });

  it("limits food image uploads after admin authorization and before upload processing", () => {
    for (const path of ["/", "/:foodId"]) {
      const method = path === "/" ? "post" : "put";
      const handlers = getRoute(foodRoutes, method, path);
      const limiterIndex = handlers.indexOf(foodImageUploadByIpLimiter);

      expect(limiterIndex).toBeGreaterThanOrEqual(0);
      expect(handlers[limiterIndex - 1]).toBe(checkAdmin);
    }
  });

  it("limits payment-status lookups before order-code processing", () => {
    const handlers = getRoute(
      orderRoutes,
      "get",
      "/payment-status/by-code/:orderCode",
    );

    expect(handlers.indexOf(paymentStatusByIpLimiter)).toBeGreaterThanOrEqual(0);
    expect(handlers.indexOf(paymentStatusByIpLimiter)).toBeLessThan(
      handlers.indexOf(checkOrderByOrderCode),
    );
  });
});
