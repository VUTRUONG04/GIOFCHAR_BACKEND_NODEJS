const {
    OUTBOX_ERROR_CODES,
    OUTBOX_PROCESSING_TIMEOUT_ERROR,
} = require("../constants/outbox.cjs");

class OutboxRepository {
    constructor(pool) {
        this.pool = pool;
    }

    async updateProcessingEvent(eventId, query, values = []) {
        const [result] = await this.pool.execute(query, [...values, eventId]);

        if (result.affectedRows !== 1) {
            const error = new Error(
                `Failed to update outbox event '${eventId}': event is missing or not processing`,
            );
            error.code = OUTBOX_ERROR_CODES.EVENT_NOT_PROCESSING;
            error.eventId = eventId;
            error.affectedRows = result.affectedRows;

            throw error;
        }

        return true;
    }

    async claimPendingBatch(batchSize = 10) {
        if (!Number.isSafeInteger(batchSize) || batchSize < 1) {
            throw new RangeError("batchSize must be a positive safe integer");
        }

        const connection = await this.pool.getConnection();

        try {
            await connection.beginTransaction();
            const [events] = await connection.execute(`
                    SELECT *
                    FROM outbox_events
                    WHERE status = 'pending'
                        AND next_retry_at <= NOW()
                    ORDER BY created_at ASC
                    LIMIT ${batchSize}
                    FOR UPDATE SKIP LOCKED
                `);

            if (events.length === 0) {
                await connection.commit();
                return [];
            }
            const ids = events.map(event => event.id);
            const placeholders = ids.map(() => "?").join(", ");
            const [result] = await connection.execute(
                `
                    UPDATE outbox_events
                    SET
                        status = 'processing',
                        attempt_count = attempt_count + 1,
                        processing_started_at = NOW()
                    WHERE id IN (${placeholders})
                `,
                ids
            );
            if (result.affectedRows !== ids.length) {
                const error = new Error(
                    `Failed to claim all outbox events: expected ${ids.length}, updated ${result.affectedRows}`
                );
                error.code = OUTBOX_ERROR_CODES.CLAIM_COUNT_MISMATCH;
                error.expectedCount = ids.length;
                error.affectedRows = result.affectedRows;

                throw error;
            }

            const [claimedEvents] = await connection.execute(
                `
                    SELECT *
                    FROM outbox_events
                    WHERE id IN (${placeholders})
                    ORDER BY created_at ASC
                `,
                ids
            );

            await connection.commit();

            return claimedEvents;
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    async markCompleted(eventId) {
        return this.updateProcessingEvent(
            eventId,
            `UPDATE outbox_events
             SET status = 'completed',
                 processed_at = NOW(),
                 processing_started_at = NULL,
                 last_error = NULL
             WHERE event_id = ?
               AND status = 'processing'`,
        );
    }

    async markRetry(eventId, { nextRetryAt, lastError }) {
        if (
            !(nextRetryAt instanceof Date && !Number.isNaN(nextRetryAt.getTime())) &&
            !(typeof nextRetryAt === "string" && nextRetryAt.trim())
        ) {
            throw new TypeError("nextRetryAt must be a valid Date or non-empty string");
        }
        if (typeof lastError !== "string" || !lastError.trim()) {
            throw new TypeError("lastError must be a non-empty string");
        }

        return this.updateProcessingEvent(
            eventId,
            `UPDATE outbox_events
             SET status = 'pending',
                 next_retry_at = ?,
                 last_error = ?,
                 processing_started_at = NULL,
                 processed_at = NULL
             WHERE event_id = ?
               AND status = 'processing'`,
            [nextRetryAt, lastError],
        );
    }

    async markFailed(eventId, { lastError }) {
        if (typeof lastError !== "string" || !lastError.trim()) {
            throw new TypeError("lastError must be a non-empty string");
        }

        return this.updateProcessingEvent(
            eventId,
            `UPDATE outbox_events
             SET status = 'failed',
                 last_error = ?,
                 processing_started_at = NULL
             WHERE event_id = ?
               AND status = 'processing'`,
            [lastError],
        );
    }

    async recoverStaleProcessing(timeout) {
        if (!Number.isSafeInteger(timeout) || timeout < 1) {
            throw new RangeError("timeout must be a positive safe integer in seconds");
        }

        await this.pool.execute(`
            UPDATE outbox_events
            SET
                status = 'pending',
                processing_started_at = NULL,
                next_retry_at = NOW(),
                last_error = ?
            WHERE status = 'processing'
              AND processing_started_at < DATE_SUB(NOW(), INTERVAL ? SECOND)
        `, [OUTBOX_PROCESSING_TIMEOUT_ERROR, timeout]);
        return true;
    }
}

module.exports = OutboxRepository;