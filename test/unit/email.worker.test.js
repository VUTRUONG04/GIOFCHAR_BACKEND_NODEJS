import { afterEach, describe, expect, it, vi } from "vitest";

import outboxConstants from "../../src/constants/outbox.cjs";
import { LOG_ACTIONS, LOG_STATUSES } from "../../src/constants/logEvents.js";
import logger from "../../src/config/logger.js";
import EmailProviderError from "../../src/errors/EmailProviderError.js";
import EmailWorker from "../../src/workers/email.worker.js";

const { MAX_ATTEMPTS, MAX_RETRY_DELAY_SECONDS } = outboxConstants;

afterEach(() => {
  vi.restoreAllMocks();
});

const createEvent = (overrides = {}) => ({
  event_id: "event-123",
  event_type: "order.created",
  payload: {
    email: "customer@example.com",
    orderCode: "DH-123",
    customerName: "Lan",
    phone: "0900000000",
    address: "123 Nguyễn Trãi",
    totalPriceOrder: 125000,
    paymentMethod: "COD",
  },
  status: "processing",
  attempt_count: 1,
  ...overrides,
});

const createWorker = ({ providerError } = {}) => {
  const provider = {
    send: providerError
      ? vi.fn().mockRejectedValue(providerError)
      : vi.fn().mockResolvedValue({ providerMessageId: "message-123" }),
  };
  const repository = {
    markCompleted: vi.fn().mockResolvedValue(true),
    markRetry: vi.fn().mockResolvedValue(true),
    markFailed: vi.fn().mockResolvedValue(true),
    recoverStaleProcessing: vi.fn().mockResolvedValue(0),
  };

  return {
    provider,
    repository,
    worker: new EmailWorker(provider, repository),
  };
};

describe("EmailWorker", () => {
  it("calculates exponential retry delays and caps them", () => {
    const { worker } = createWorker();

    expect(
      [1, 2, 3, 4, 5].map((attempt) => worker.exponentialBackoff(attempt)),
    ).toEqual([30, 60, 120, 240, 480]);
    expect(worker.exponentialBackoff(10)).toBe(MAX_RETRY_DELAY_SECONDS);
    expect(() => worker.exponentialBackoff(0)).toThrow(RangeError);
    expect(() => worker.exponentialBackoff(1.5)).toThrow(RangeError);
  });

  it("sends the built email and marks its event completed", async () => {
    const { provider, repository, worker } = createWorker();

    await expect(worker.execute(createEvent())).resolves.toBe(true);

    expect(provider.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "customer@example.com",
        subject: expect.stringContaining("DH-123"),
        idempotencyKey: "event-123",
      }),
    );
    const emailHtml = provider.send.mock.calls[0][0].html;
    expect(emailHtml).toContain("0900000000");
    expect(emailHtml).toContain("123 Nguyễn Trãi");
    expect(repository.markCompleted).toHaveBeenCalledWith("event-123");
    expect(repository.markRetry).not.toHaveBeenCalled();
    expect(repository.markFailed).not.toHaveBeenCalled();
  });

  it("skips an event that is not processing", async () => {
    const { provider, repository, worker } = createWorker();

    await expect(
      worker.execute(createEvent({ status: "pending" })),
    ).resolves.toBe(false);

    expect(provider.send).not.toHaveBeenCalled();
    expect(repository.markCompleted).not.toHaveBeenCalled();
  });

  it("schedules a retryable failure using exponential backoff", async () => {
    const providerError = new EmailProviderError("Temporary provider error", {
      retryable: true,
    });
    const { provider, repository, worker } = createWorker({ providerError });

    await expect(
      worker.execute(createEvent({ attempt_count: 2 })),
    ).resolves.toBe(false);

    expect(provider.send).toHaveBeenCalledOnce();
    expect(repository.markRetry).toHaveBeenCalledWith("event-123", {
      delaySeconds: 60,
      lastError: "Temporary provider error",
    });
    expect(repository.markFailed).not.toHaveBeenCalled();
    expect(repository.markCompleted).not.toHaveBeenCalled();
  });

  it("marks a retryable failure as failed after the maximum attempt", async () => {
    const providerError = new EmailProviderError("Still unavailable", {
      retryable: true,
    });
    const { repository, worker } = createWorker({ providerError });

    await expect(
      worker.execute(createEvent({ attempt_count: MAX_ATTEMPTS })),
    ).resolves.toBe(false);

    expect(repository.markFailed).toHaveBeenCalledWith("event-123", {
      lastError: "Still unavailable",
    });
    expect(repository.markRetry).not.toHaveBeenCalled();
  });

  it("marks non-retryable delivery errors as failed", async () => {
    const providerError = new EmailProviderError("Invalid recipient");
    const { repository, worker } = createWorker({ providerError });

    await expect(worker.execute(createEvent())).resolves.toBe(false);

    expect(repository.markFailed).toHaveBeenCalledWith("event-123", {
      lastError: "Invalid recipient",
    });
    expect(repository.markRetry).not.toHaveBeenCalled();
  });

  it("marks email construction errors as failed", async () => {
    const { provider, repository, worker } = createWorker();

    await expect(
      worker.execute(createEvent({ event_type: "unsupported.event" })),
    ).resolves.toBe(false);

    expect(provider.send).not.toHaveBeenCalled();
    expect(repository.markFailed).toHaveBeenCalledWith(
      "event-123",
      expect.objectContaining({
        lastError: "Unsupported email event type: unsupported.event",
      }),
    );
  });

  it("propagates repository failures when recording delivery failures", async () => {
    const providerError = new EmailProviderError("Temporary provider error", {
      retryable: true,
    });
    const stateError = new Error("Database unavailable");
    const { repository, worker } = createWorker({ providerError });
    repository.markRetry.mockRejectedValue(stateError);

    await expect(worker.execute(createEvent())).rejects.toBe(stateError);
  });

  it("propagates failure to mark a successfully sent event completed", async () => {
    const stateError = new Error("Database unavailable");
    const { repository, worker } = createWorker();
    repository.markCompleted.mockRejectedValue(stateError);

    await expect(worker.execute(createEvent())).rejects.toBe(stateError);
  });

  it("logs how many stale events were recovered", async () => {
    const { repository, worker } = createWorker();
    repository.recoverStaleProcessing.mockResolvedValue(3);
    const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => logger);

    await expect(worker.pollRecovery()).resolves.toBe(3);

    expect(repository.recoverStaleProcessing).toHaveBeenCalledOnce();
    expect(infoSpy).toHaveBeenCalledWith(LOG_ACTIONS.EMAIL.RECOVERY, {
      status: LOG_STATUSES.RECOVERED,
      recoveredCount: 3,
    });
  });

  it("does not log routine polls when no stale events were recovered", async () => {
    const { repository, worker } = createWorker();
    const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => logger);

    await expect(worker.pollRecovery()).resolves.toBe(0);

    expect(repository.recoverStaleProcessing).toHaveBeenCalledOnce();
    expect(infoSpy).not.toHaveBeenCalledWith(
      LOG_ACTIONS.EMAIL.RECOVERY,
      expect.anything(),
    );
  });

  it("logs and propagates errors from recovery polling", async () => {
    const recoveryError = Object.assign(new Error("Database unavailable"), {
      code: "DB_UNAVAILABLE",
    });
    const { repository, worker } = createWorker();
    repository.recoverStaleProcessing.mockRejectedValue(recoveryError);
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => logger);

    await expect(worker.pollRecovery()).rejects.toBe(recoveryError);

    expect(errorSpy).toHaveBeenCalledWith(LOG_ACTIONS.EMAIL.RECOVERY, {
      status: LOG_STATUSES.FAILED,
      operation: "poll_recovery",
      reason: "DB_UNAVAILABLE",
      error: "Database unavailable",
    });
  });
});
