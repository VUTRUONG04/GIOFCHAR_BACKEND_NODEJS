import express from "express";

import emailJobController from "../controllers/emailJob.controller.js";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { checkAdmin } from "../middlewares/user.middleware.js";

const router = express.Router();

router.use(requireAuth, checkAdmin);

router.get("/email-jobs", emailJobController.listEmailJobs);
router.get("/email-jobs/:id", emailJobController.getEmailJobById);
router.post("/email-jobs/:id/retry", emailJobController.retryEmailJob);

export default router;
