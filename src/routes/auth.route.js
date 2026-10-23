import express from "express";
const router = express.Router();
import { requireAuth } from "../middlewares/auth.middleware.js";

import {
  getAccount,
  loginApi,
  logoutController,
  refreshTokenController,
  registerApi,
} from "../controllers/auth.controller.js";
import {
  loginByEmailLimiter,
  loginByIpLimiter,
  registerByIpLimiter,
} from "../middlewares/rateLimitLimiters.middleware.js";
import { loginSchema, registerSchema } from "../validators/auth.validator.js";
import { validate } from "../middlewares/validate.middleware.js";

router.post("/logout", logoutController);
router.post("/refresh", refreshTokenController);
router.get("/account", requireAuth, getAccount);
router.post(
  "/login",
  loginByIpLimiter,
  validate(loginSchema),
  loginByEmailLimiter,
  loginApi,
);

router.post(
  "/register",
  registerByIpLimiter,
  validate(registerSchema),
  registerApi,
);
export default router;
