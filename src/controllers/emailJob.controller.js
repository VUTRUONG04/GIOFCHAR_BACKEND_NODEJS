import { asyncHandler } from "../errors/errorHandler.js";
import emailJobService from "../services/emailJob.service.js";

const listEmailJobs = asyncHandler(async (req, res) => {
  const result = await emailJobService.listEmailJobs({
    page: req.query.page,
    pageSize: req.query.pageSize,
    status: req.query.status,
  });
  res.status(200).json(result);
});

const getEmailJobById = asyncHandler(async (req, res) => {
  const event = await emailJobService.getEmailJobById(req.params.id);
  res.status(200).json({ event });
});

const retryEmailJob = asyncHandler(async (req, res) => {
  const result = await emailJobService.retryEmailJob(req.params.id);
  res.status(200).json({
    message: "Email job queued for retry",
    ...result,
  });
});

export default {
  listEmailJobs,
  getEmailJobById,
  retryEmailJob,
};
