import express from "express";
const router = express.Router();

import { requireAuth, optionalAuth } from "../middlewares/auth.middleware.js";
import { checkAdmin } from "../middlewares/user.middleware.js";
import { cartMutationByIpLimiter } from "../middlewares/rateLimitLimiters.middleware.js";

import {
  clearCartController,
  deleteCartItemController,
  addFoodToCartController,
  getAllCartItemsController,
  getAllCartsController,
} from "../controllers/cart.controller.js";

router.delete("/", optionalAuth, cartMutationByIpLimiter, clearCartController);
router.delete(
  "/:cartItemId",
  optionalAuth,
  cartMutationByIpLimiter,
  deleteCartItemController,
);
router.post(
  "/cartItem",
  optionalAuth,
  cartMutationByIpLimiter,
  addFoodToCartController,
);
router.get("/my-cartItems", optionalAuth, getAllCartItemsController);
router.get("/", requireAuth, checkAdmin, getAllCartsController);

export default router;
