import { afterEach, describe, expect, it, vi } from "vitest";

import outboxConstants from "../../src/constants/outbox.cjs";
import { POLL_INTERVAL_MS } from "../../src/constants/email.js";
import { LOG_ACTIONS, LOG_STATUSES } from "../../src/constants/logEvents.js";
import logger from "../../src/config/logger.js";
import EmailProviderError from "../../src/errors/EmailProviderError.js";
import EmailWorker from "../../src/workers/email.worker.js";

const { MAX_ATTEMPTS, MAX_RETRY_DELAY_SECONDS } = outboxConstants;

afterEach(() => {
  vi.useRealTimers();
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
    claimPendingBatch: vi.fn().mockResolvedValue([]),
  };

  return {
    provider,
    repository,
    worker: new EmailWorker(provider, repository),
  };
};

const createDeferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
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

  it("returns zero counts when there are no pending events", async () => {
    const { repository, worker } = createWorker();
    const debugSpy = vi.spyOn(logger, "debug").mockImplementation(() => logger);
    const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => logger);

    await expect(worker.pollPending()).resolves.toEqual({
      claimedCount: 0,
      completedCount: 0,
      deferredCount: 0,
      errorCount: 0,
    });

    expect(repository.claimPendingBatch).toHaveBeenCalledOnce();
    expect(debugSpy).toHaveBeenCalledWith(LOG_ACTIONS.EMAIL.POLL, {
      claimedCount: 0,
    });
    expect(infoSpy).not.toHaveBeenCalledWith(
      LOG_ACTIONS.EMAIL.POLL,
      expect.anything(),
    );
  });

  it("processes all claimed events and reports accurate outcomes", async () => {
    const { repository, worker } = createWorker();
    const events = [
      createEvent({ event_id: "event-completed" }),
      createEvent({ event_id: "event-error" }),
      createEvent({ event_id: "event-deferred" }),
    ];
    repository.claimPendingBatch.mockResolvedValue(events);
    const executeSpy = vi
      .spyOn(worker, "execute")
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error("Outbox update failed"))
      .mockResolvedValueOnce(false);
    const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => logger);

    await expect(worker.pollPending()).resolves.toEqual({
      claimedCount: 3,
      completedCount: 1,
      deferredCount: 1,
      errorCount: 1,
    });

    expect(executeSpy.mock.calls.map(([event]) => event.event_id)).toEqual([
      "event-completed",
      "event-error",
      "event-deferred",
    ]);
    expect(infoSpy).toHaveBeenCalledWith(LOG_ACTIONS.EMAIL.POLL, {
      status: LOG_STATUSES.COMPLETED,
      claimedCount: 3,
      completedCount: 1,
      deferredCount: 1,
      errorCount: 1,
    });
  });

  it("propagates errors when claiming the pending batch fails", async () => {
    const claimError = new Error("Database unavailable");
    const { repository, worker } = createWorker();
    repository.claimPendingBatch.mockRejectedValue(claimError);
    const executeSpy = vi.spyOn(worker, "execute");

    await expect(worker.pollPending()).rejects.toBe(claimError);

    expect(executeSpy).not.toHaveBeenCalled();
  });

  it("returns the active run promise and avoids starting a second loop", async () => {
    const { worker } = createWorker();
    const pollStarted = createDeferred();
    const finishPoll = createDeferred();
    const pollPendingSpy = vi
      .spyOn(worker, "pollPending")
      .mockImplementationOnce(async () => {
        pollStarted.resolve();
        await finishPoll.promise;
      });

    const firstRun = worker.start();
    await pollStarted.promise;
    const secondRun = worker.start();

    expect(secondRun).toBe(firstRun);
    expect(pollPendingSpy).toHaveBeenCalledOnce();

    const stopping = worker.stop();
    finishPoll.resolve();
    await expect(stopping).resolves.toBeUndefined();
    await expect(firstRun).resolves.toBeUndefined();
    expect(worker.running).toBe(false);
    expect(worker.runPromise).toBeNull();
  });

  it("waits for an in-flight poll to finish before stop resolves", async () => {
    const { worker } = createWorker();
    const pollStarted = createDeferred();
    const finishPoll = createDeferred();
    vi.spyOn(worker, "pollPending").mockImplementationOnce(async () => {
      pollStarted.resolve();
      await finishPoll.promise;
    });

    worker.start();
    await pollStarted.promise;

    let stopped = false;
    const stopping = worker.stop().then(() => {
      stopped = true;
    });

    await Promise.resolve();
    expect(stopped).toBe(false);

    finishPoll.resolve();
    await stopping;
    expect(stopped).toBe(true);
  });

  it("waits between polling iterations", async () => {
    vi.useFakeTimers();
    const { worker } = createWorker();
    const pollPendingSpy = vi
      .spyOn(worker, "pollPending")
      .mockResolvedValue({
        claimedCount: 0,
        completedCount: 0,
        deferredCount: 0,
        errorCount: 0,
      });

    const runPromise = worker.start();
    expect(pollPendingSpy).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS - 1);
    expect(pollPendingSpy).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(1);
    expect(pollPendingSpy).toHaveBeenCalledTimes(2);

    const stopping = worker.stop();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    await expect(stopping).resolves.toBeUndefined();
    await expect(runPromise).resolves.toBeUndefined();
  });

  it("returns loop failures to the caller and resets its lifecycle state", async () => {
    const runError = new Error("Pending event poll failed");
    const { worker } = createWorker();
    vi.spyOn(worker, "pollPending").mockRejectedValueOnce(runError);

    const runPromise = worker.start();
    await expect(runPromise).rejects.toBe(runError);

    expect(worker.running).toBe(false);
    expect(worker.runPromise).toBeNull();
    await expect(worker.stop()).resolves.toBeUndefined();
  });

  it("propagates a loop failure through stop while it waits", async () => {
    const runError = new Error("Pending event poll failed");
    const { worker } = createWorker();
    const pollStarted = createDeferred();
    const failPoll = createDeferred();
    vi.spyOn(worker, "pollPending").mockImplementationOnce(async () => {
      pollStarted.resolve();
      await failPoll.promise;
    });

    const runPromise = worker.start();
    await pollStarted.promise;
    const stopping = worker.stop();
    failPoll.reject(runError);

    await expect(stopping).rejects.toBe(runError);
    await expect(runPromise).rejects.toBe(runError);
    expect(worker.running).toBe(false);
    expect(worker.runPromise).toBeNull();
  });
});
