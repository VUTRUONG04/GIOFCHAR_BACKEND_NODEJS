class OutboxRepository {
    constructor(pool) {
        this.pool = pool;
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
                error.code = "OUTBOX_CLAIM_COUNT_MISMATCH";
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
}

module.exports = OutboxRepository;