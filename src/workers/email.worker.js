import pool from "../config/db.js";
import {
  BASE_RETRY_DELAY_SECONDS,
  MAX_ATTEMPT_RETRY,
  MAX_RETRY_DELAY_SECONDS,
} from "../constants/outbox.cjs";
import { LOG_ACTIONS, LOG_STATUSES } from "../constants/logEvents.js";
import EmailProviderError from "../errors/EmailProviderError.js";
import OutboxRepository from "../repositories/outbox.repository.js";
import logger from "../config/logger.js";
import buildEmail from "../services/email/buildEmail.js";

const outboxRepository = new OutboxRepository(pool);
class EmailWorker {
  constructor(provider, repository = outboxRepository) {
    this.provider = provider;
    this.repository = repository;
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
          attempt_count < MAX_ATTEMPT_RETRY
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
}

export default EmailWorker;
