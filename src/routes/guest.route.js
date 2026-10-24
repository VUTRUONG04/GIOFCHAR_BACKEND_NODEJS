import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import { guestInitByIpLimiter } from "../middlewares/rateLimitLimiters.middleware.js";

const router = Router();

router.post(
  "/init",
  guestInitByIpLimiter,
  (req, res) => {
    const guestToken = uuidv4();

    return res.status(200).json({
      guest_token: guestToken,
    });
  },
);

export default router;
