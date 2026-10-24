import { createHmac } from "node:crypto";
import validator from "validator";

function getRateLimitHashSecret() {
  const secret = process.env.RATE_LIMIT_HASH_SECRET;

  if (typeof secret !== "string" || secret.trim() === "") {
    throw new Error("RATE_LIMIT_HASH_SECRET is not configured");
  }

  return secret;
}

export function getLoginIdentifier(req) {
  const email = req.body?.email;

  if (typeof email !== "string") {
    return null;
  }

  const normalizedEmail = email.trim().toLowerCase();

  if (!validator.isEmail(normalizedEmail)) {
    return null;
  }

  return createHmac("sha256", getRateLimitHashSecret())
    .update(normalizedEmail)
    .digest("hex");
}

function getClientIp(req) {
  const ip = req.ip;

  if (typeof ip !== "string" || ip.trim() === "") {
    throw new Error("Client IP is missing or invalid");
  }

  return ip;
}

// Initial values for development and testing.
// These limits must be reviewed against actual traffic and security requirements.
export const rateLimitPolicies = {
  loginByIp: {
    keyPrefix: "login:ip",
    windowMs: 15 * 60 * 1000,
    maxCountRequest: 30,
    keyGenerator: getClientIp,
  },

  loginByEmail: {
    keyPrefix: "login:email",
    windowMs: 15 * 60 * 1000,
    maxCountRequest: 5,
    keyGenerator: getLoginIdentifier,
  },

  registerByIp: {
    keyPrefix: "register:ip",
    windowMs: 60 * 60 * 1000,
    maxCountRequest: 10,
    keyGenerator: getClientIp,
  },

  guestInitByIp: {
    keyPrefix: "guest:init:ip",
    windowMs: 60 * 60 * 1000,
    maxCountRequest: 15,
    keyGenerator: getClientIp,
  },

  codOrderByIp: {
    keyPrefix: "order:cod:ip",
    windowMs: 15 * 60 * 1000,
    maxCountRequest: 10,
    keyGenerator: getClientIp,
  },

  cartMutationByIp: {
    keyPrefix: "cart:mutation:ip",
    windowMs: 60 * 1000,
    maxCountRequest: 60,
    keyGenerator: getClientIp,
  },

  foodImageUploadByIp: {
    keyPrefix: "food:image-upload:ip",
    windowMs: 60 * 60 * 1000,
    maxCountRequest: 20,
    keyGenerator: getClientIp,
  },

  paymentStatusByIp: {
    keyPrefix: "order:payment-status:ip",
    windowMs: 60 * 1000,
    maxCountRequest: 30,
    keyGenerator: getClientIp,
  },

  globalApiByIp: {
    keyPrefix: "global:api:ip",
    windowMs: 60 * 1000,
    maxCountRequest: 120,
    keyGenerator: getClientIp,
  },
};
