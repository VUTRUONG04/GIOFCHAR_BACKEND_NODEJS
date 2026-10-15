import outboxConstants from "../constants/outbox.cjs";
import { BadRequestError, ConflictError, NotFoundError } from "../errors/AppError.js";
import OutboxRepository from "../repositories/outbox.repository.js";
import pool from "../config/db.js";

const outboxRepository = new OutboxRepository(pool);
const EVENT_STATUSES = ["pending", "processing", "completed", "failed"];
const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const { OUTBOX_PROCESSING_TIMEOUT_ERROR } = outboxConstants;

const parsePositiveInteger = (value, name, defaultValue) => {
  if (value === undefined) return defaultValue;
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    throw new BadRequestError(`${name} must be a positive integer`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new BadRequestError(`${name} is too large`);
  }
  return parsed;
};

const validateId = (id) => {
  if (typeof id !== "string" || !/^[1-9]\d*$/.test(id)) {
    throw new BadRequestError("Email job id must be a positive integer");
  }
  if (BigInt(id) > 18446744073709551615n) {
    throw new BadRequestError("Email job id is too large");
  }
};

const listEmailJobs = async ({ page, pageSize, status }) => {
  const parsedPage = parsePositiveInteger(page, "page", DEFAULT_PAGE);
  const parsedPageSize = parsePositiveInteger(
    pageSize,
    "pageSize",
    DEFAULT_PAGE_SIZE,
  );
  if (parsedPageSize > MAX_PAGE_SIZE) {
    throw new BadRequestError(`pageSize must not exceed ${MAX_PAGE_SIZE}`);
  }
  if (status !== undefined && !EVENT_STATUSES.includes(status)) {
    throw new BadRequestError("Invalid email job status");
  }

  const offset = (parsedPage - 1) * parsedPageSize;
  if (!Number.isSafeInteger(offset)) {
    throw new BadRequestError("Requested page is too large");
  }

  const { events, total } = await outboxRepository.listAdminEvents({
    status,
    limit: parsedPageSize,
    offset,
  });

  return {
    events,
    pagination: {
      page: parsedPage,
      pageSize: parsedPageSize,
      total,
      totalPages: Math.ceil(total / parsedPageSize),
    },
  };
};

const getEmailJobById = async (id) => {
  validateId(id);
  const event = await outboxRepository.getAdminEventById(id);
  if (!event) throw new NotFoundError("Email job not found");
  return event;
};

const retryEmailJob = async (id) => {
  validateId(id);
  const retried = await outboxRepository.retryFailedEvent(id);
  if (retried) return { id, status: "pending", attemptCount: 0 };

  const event = await outboxRepository.getAdminEventById(id);
  if (!event) throw new NotFoundError("Email job not found");

  if (
    event.status !== "failed" ||
    event.lastError === OUTBOX_PROCESSING_TIMEOUT_ERROR
  ) {
    throw new ConflictError(
      "Only eligible failed email jobs can be retried manually",
      "EMAIL_JOB_NOT_RETRYABLE",
    );
  }

  throw new ConflictError(
    "Email job changed before it could be retried",
    "EMAIL_JOB_RETRY_CONFLICT",
  );
};

export default {
  listEmailJobs,
  getEmailJobById,
  retryEmailJob,
};
