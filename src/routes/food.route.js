import express from "express";
const router = express.Router();

import upload from "../config/multer.js";
import {
  uploadToCloudinary,
  cleanupCloudinary,
} from "../middlewares/cloudinary.middleware.js";
import { requireAuth, optionalAuth } from "../middlewares/auth.middleware.js";
import { checkAdmin } from "../middlewares/user.middleware.js";

import foodController from "../controllers/food.controller.js";

import { checkFoodExists } from "../middlewares/checkFood.js";
import { asyncHandler } from "../errors/errorHandler.js";
import { foodImageUploadByIpLimiter } from "../middlewares/rateLimitLimiters.middleware.js";
import {
  createVariantController,
  getVariantByFoodController,
} from "../controllers/variant.controller.js";
import { checkCategoryExists } from "../middlewares/checkCategory.js";
router.delete(
  "/:foodId",
  requireAuth,
  checkAdmin,
  foodController.deleteFoodById, // delete food
);
router.put(
  "/:foodId",
  requireAuth,
  checkAdmin,
  foodImageUploadByIpLimiter,

  upload.single("imageFood"),
  uploadToCloudinary,
  cleanupCloudinary,

  checkFoodExists,
  checkCategoryExists,
  foodController.updateFoodById,
);
router.post(
  "/",
  requireAuth,
  checkAdmin,
  foodImageUploadByIpLimiter,
  upload.single("imageFood"),
  uploadToCloudinary,
  cleanupCloudinary, // xóa ảnh nếu có lỗi xảy ra khi res.json() ở 2 controller sau

  checkCategoryExists,
  foodController.createFood,
);
router.post(
  "/:foodId/variants",
  requireAuth,
  checkAdmin,
  checkFoodExists,
  asyncHandler(createVariantController),
);
router.get(
  "/:foodId/variants",
  requireAuth,
  checkAdmin,
  asyncHandler(getVariantByFoodController),
);
router.get("/promotions", optionalAuth, foodController.getFoodsPromotion);
router.get("/best-selling", optionalAuth, foodController.getAllBestSelling);
router.get("/:foodId", optionalAuth, foodController.getDetailFood);
router.get("/", optionalAuth, foodController.getAllFoods);

export default router;
