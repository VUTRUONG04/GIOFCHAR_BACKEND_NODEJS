import { beforeEach, describe, expect, it, vi } from "vitest";

const { repository } = vi.hoisted(() => ({
  repository: {
    listAdminEvents: vi.fn(),
    getAdminEventById: vi.fn(),
    retryFailedEvent: vi.fn(),
  },
}));

vi.mock("../../src/repositories/outbox.repository.js", () => ({
  default: class MockOutboxRepository {
    constructor() {
      return repository;
    }
  },
}));

import emailJobService from "../../src/services/emailJob.service.js";

describe("emailJobService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("paginates and filters the admin event list", async () => {
    repository.listAdminEvents.mockResolvedValue({
      events: [{ id: 3, status: "failed" }],
      total: 21,
    });

    const result = await emailJobService.listEmailJobs({
      page: "2",
      pageSize: "10",
      status: "failed",
    });

    expect(repository.listAdminEvents).toHaveBeenCalledWith({
      status: "failed",
      limit: 10,
      offset: 10,
    });
    expect(result.pagination).toEqual({
      page: 2,
      pageSize: 10,
      total: 21,
      totalPages: 3,
    });
  });

  it("rejects an invalid status filter", async () => {
    await expect(
      emailJobService.listEmailJobs({ status: "sent" }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(repository.listAdminEvents).not.toHaveBeenCalled();
  });

  it("returns a not found error for an unknown job id", async () => {
    repository.getAdminEventById.mockResolvedValue(null);

    await expect(emailJobService.getEmailJobById("123")).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("resets an eligible failed job for immediate retry", async () => {
    repository.retryFailedEvent.mockResolvedValue(true);

    await expect(emailJobService.retryEmailJob("123")).resolves.toEqual({
      id: "123",
      status: "pending",
      attemptCount: 0,
    });
  });

  it("rejects retry for events not eligible for manual retry", async () => {
    repository.retryFailedEvent.mockResolvedValue(false);
    repository.getAdminEventById.mockResolvedValue({
      id: 123,
      status: "pending",
      lastError: null,
    });

    await expect(emailJobService.retryEmailJob("123")).rejects.toMatchObject({
      statusCode: 409,
      code: "EMAIL_JOB_NOT_RETRYABLE",
    });
  });

  it("rejects manual retry of recovery-timeout events", async () => {
    repository.retryFailedEvent.mockResolvedValue(false);
    repository.getAdminEventById.mockResolvedValue({
      id: 123,
      status: "failed",
      lastError: "Processing timeout; job requeued",
    });

    await expect(emailJobService.retryEmailJob("123")).rejects.toMatchObject({
      statusCode: 409,
      code: "EMAIL_JOB_NOT_RETRYABLE",
    });
  });
});
