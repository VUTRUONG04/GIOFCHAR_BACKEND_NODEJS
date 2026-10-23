import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  UnauthorizedError,
} from "../errors/AppError.js";
import { asyncHandler } from "../errors/errorHandler.js";
import authService from "../services/auth.service.js";
import { refreshNewToken } from "../services/refreshToken.service.js";
import userService from "../services/user.service.js";

export const registerApi = asyncHandler(async (req, res) => {
  const { userName, email, phone, password, address } = req.body;
  const guestToken = req.headers["x-guest-token"];

  const result = await authService.register(
    userName,
    email,
    phone,
    password,
    address,
    guestToken,
  );

  return res
    .status(201)
    .json({ message: "Register successful", userId: result.insertId });
});

export const loginApi = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const guestToken = req.headers["x-guest-token"];

  const result = await authService.login(email, password, guestToken);
  const { refresh_token, mergeStatus, ...loginInfo } = result;

  res.cookie("refreshToken", refresh_token, {
    httpOnly: true,
    secure: true,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  res.status(200).json({
    message: "Login successful",
    data: { ...loginInfo, mergeCart: mergeStatus ? "success" : "failed" },
  });
});

export const getAccount = asyncHandler(async (req, res) => {
  const userId = req.user.userId;

  const user = await userService.getUserById(userId);
  if (!user) throw new NotFoundError("User not found");
  return res.status(200).json(user);
});

export const refreshTokenController = asyncHandler(async (req, res) => {
  const { refreshToken: oldToken } = req.cookies;
  if (!oldToken) {
    throw new UnauthorizedError("Missing refresh token");
  }
  const { accessToken, refreshToken } = await refreshNewToken(oldToken);
  res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    secure: true,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
  return res.status(200).json({ accessToken });
});

export const logoutController = asyncHandler(async (req, res) => {
  const { refreshToken: oldToken } = req.cookies;
  try {
    if (oldToken) {
      await authService.logout(oldToken);
    }
  } catch (error) {
    // ignore
  }
  res.clearCookie("refreshToken");
  res.status(200).json({
    message: "Logout successful",
  });
});
