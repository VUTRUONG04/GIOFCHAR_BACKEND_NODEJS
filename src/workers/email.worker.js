import pool from "../config/db.js";
import {
  BASE_RETRY_DELAY_SECONDS,
  MAX_ATTEMPTS,
  MAX_RETRY_DELAY_SECONDS,
} from "../constants/outbox.cjs";
import { LOG_ACTIONS, LOG_STATUSES } from "../constants/logEvents.js";
import EmailProviderError from "../errors/EmailProviderError.js";
import OutboxRepository from "../repositories/outbox.repository.js";
import logger from "../config/logger.js";
import buildEmail from "../services/email/buildEmail.js";
import { POLL_INTERVAL_MS, RECOVERY_INTERVAL_MS } from "../constants/email.js";

const outboxRepository = new OutboxRepository(pool);
const sleep = (durationMs) =>
  new Promise((resolve) => setTimeout(resolve, durationMs));

class EmailWorker {
  constructor(provider, repository = outboxRepository) {
    this.provider = provider;
    this.repository = repository;
    this.running = false;
    this.runPromise = null;
  }

  exponentialBackoff(attemptCount) {
    if (!Number.isSafeInteger(attemptCount) || attemptCount < 1) {
      throw new RangeError("attemptCount must be a positive safe integer");
    }

    return Math.min(
      BASE_RETRY_DELAY_SECONDS * 2 ** (attemptCount - 1),
      MAX_RETRY_DELAY_SECONDS,
    );
  }

  async execute({ event_id, event_type, payload, status, attempt_count }) {
    if (status !== "processing") {
      logger.debug(LOG_ACTIONS.EMAIL.WORKER, {
        status: LOG_STATUSES.SKIPPED,
        reason: "EVENT_NOT_PROCESSING",
        eventId: event_id,
        eventType: event_type,
      });
      return false;
    }

    let providerMessageId;

    // Gui mail
    try {
      const { subject, html } = buildEmail(event_type, payload);
      ({ providerMessageId } = await this.provider.send({
        to: payload.email,
        subject,
        html,
        idempotencyKey: event_id,
      }));
    } catch (error) {
      const lastError =
        error instanceof Error && error.message.trim()
          ? error.message
          : "Unexpected email worker error";
      const reason = error?.code || error?.name || "UNKNOWN_ERROR";
      const logContext = {
        eventId: event_id,
        eventType: event_type,
        attemptCount: attempt_count,
        reason,
      };

      try {
        if (
          error instanceof EmailProviderError &&
          error.retryable &&
          attempt_count < MAX_ATTEMPTS
        ) {
          const delaySeconds = this.exponentialBackoff(attempt_count);
          await this.repository.markRetry(event_id, {
            delaySeconds,
            lastError,
          });
          logger.warn(LOG_ACTIONS.EMAIL.WORKER, {
            ...logContext,
            status: LOG_STATUSES.RETRYING,
            retryDelaySeconds: delaySeconds,
          });
          return false;
        }

        await this.repository.markFailed(event_id, { lastError });
        logger.error(LOG_ACTIONS.EMAIL.WORKER, {
          ...logContext,
          status: LOG_STATUSES.FAILED,
          retryable: error instanceof EmailProviderError && error.retryable,
        });
        return false;
      } catch (stateError) {
        logger.error(LOG_ACTIONS.EMAIL.WORKER, {
          ...logContext,
          status: LOG_STATUSES.FAILED,
          reason:
            stateError?.code || stateError?.name || "OUTBOX_UPDATE_FAILED",
          operation: "update_outbox_state",
        });
        throw stateError;
      }
    }

    // THanh cong thi danh giau thanh cong
    try {
      await this.repository.markCompleted(event_id);
    } catch (error) {
      logger.error(LOG_ACTIONS.EMAIL.WORKER, {
        eventId: event_id,
        eventType: event_type,
        attemptCount: attempt_count,
        reason: error?.code || error?.name || "OUTBOX_UPDATE_FAILED",
        operation: "mark_completed",
      });
      throw error;
    }

    logger.info(LOG_ACTIONS.EMAIL.WORKER, {
      status: LOG_STATUSES.COMPLETED,
      eventId: event_id,
      eventType: event_type,
      attemptCount: attempt_count,
      providerMessageId,
    });
    return true;
  }

  async pollRecovery() {
    try {
      const recoveryCount = await this.repository.recoverStaleProcessing();
      if (recoveryCount > 0) {
        logger.info(LOG_ACTIONS.EMAIL.RECOVERY, {
          status: LOG_STATUSES.RECOVERED,
          recoveredCount: recoveryCount,
        });
      }
      return recoveryCount;
    } catch (error) {
      logger.error(LOG_ACTIONS.EMAIL.RECOVERY, {
        status: LOG_STATUSES.FAILED,
        operation: "poll_recovery",
        reason: error?.code || error?.name || "RECOVERY_FAILED",
        error:
          error instanceof Error ? error.message : "Unknown recovery error",
      });
      throw error;
    }
  }

  async pollPending() {
    let events;
    try {
      events = await this.repository.claimPendingBatch();
      logger.debug(LOG_ACTIONS.EMAIL.POLL, {
        claimedCount: events.length,
      });
      if (!events.length) {
        return {
          claimedCount: 0,
          completedCount: 0,
          deferredCount: 0,
          errorCount: 0,
        };
      }
    } catch (error) {
      logger.warn(LOG_ACTIONS.EMAIL.POLL, {
        status: LOG_STATUSES.FAILED,
        operation: "claim_pending_batch",
        reason: error?.name || error?.code || "DB_FAILED",
      });
      throw error;
    }

    let completedCount = 0;
    let deferredCount = 0;
    let errorCount = 0;

    for (const event of events) {
      try {
        const completed = await this.execute(event);
        if (completed) {
          completedCount++;
        } else {
          deferredCount++;
        }
      } catch {
        errorCount++;
      }
    }

    logger.info(LOG_ACTIONS.EMAIL.POLL, {
      status: LOG_STATUSES.COMPLETED,
      claimedCount: events.length,
      completedCount,
      deferredCount,
      errorCount,
    });

    return {
      claimedCount: events.length,
      completedCount,
      deferredCount,
      errorCount,
    };
  }

  async run() {
    let lastRecoveryAt = Date.now();
    while (this.running) {
      if (lastRecoveryAt + RECOVERY_INTERVAL_MS <= Date.now()) {
        await this.pollRecovery();
        lastRecoveryAt = Date.now();
      }

      if (!this.running) break;
      await this.pollPending();

      if (!this.running) break;
      await sleep(POLL_INTERVAL_MS);
    }
  }

  async stop() {
    this.running = false;
    if (this.runPromise) {
      await this.runPromise;
    }
  }

  start() {
    if (this.runPromise !== null) {
      return this.runPromise;
    }
    if (this.running) {
      throw new Error("Email worker is running without a tracked run promise");
    }

    this.running = true;

    let runPromise;
    runPromise = this.run().finally(() => {
      if (this.runPromise === runPromise) {
        this.running = false;
        this.runPromise = null;
      }
    });

    this.runPromise = runPromise;
    return runPromise;
  }
}

export default EmailWorker;
