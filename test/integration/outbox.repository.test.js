import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import mysql from "mysql2/promise";
import { randomUUID } from "node:crypto";

import outboxConstants from "../../src/constants/outbox.cjs";
import OutboxRepository from "../../src/repositories/outbox.repository.js";

const testAggregateType = "test_outbox_repository";
const { OUTBOX_ERROR_CODES, OUTBOX_PROCESSING_TIMEOUT_ERROR } = outboxConstants;
const testPool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: Number(process.env.DB_PORT),
});
const repository = new OutboxRepository(testPool);

async function cleanTestEvents() {
  await testPool.execute(
    "DELETE FROM outbox_events WHERE aggregate_type = ?",
    [testAggregateType],
  );
}

async function insertTestEvent({ status = "pending", retryAt } = {}) {
  const eventId = randomUUID();
  const query = retryAt
    ? `INSERT INTO outbox_events
        (event_id, event_type, aggregate_type, aggregate_id, payload, status, next_retry_at)
       VALUES (?, 'test.event', ?, 1, '{}', ?, ?)`
    : `INSERT INTO outbox_events
        (event_id, event_type, aggregate_type, aggregate_id, payload, status)
       VALUES (?, 'test.event', ?, 1, '{}', ?)`;
  const values = retryAt
    ? [eventId, testAggregateType, status, retryAt]
    : [eventId, testAggregateType, status];

  await testPool.execute(query, values);
  return eventId;
}

describe("OutboxRepository (MySQL integration)", () => {
  beforeEach(async () => {
    await cleanTestEvents();
  });

  afterEach(async () => {
    await cleanTestEvents();
  });

  afterAll(async () => {
    await testPool.end();
  });

  it("claims only due pending events and increments their attempts", async () => {
    const dueEventId = await insertTestEvent();
    const delayedEventId = await insertTestEvent({
      retryAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    const processingEventId = await insertTestEvent({ status: "processing" });

    const claimedEvents = await repository.claimPendingBatch(10);

    expect(claimedEvents.map(({ event_id }) => event_id)).toEqual([dueEventId]);
    expect(claimedEvents[0]).toMatchObject({
      status: "processing",
      attempt_count: 1,
    });

    const [remainingEvents] = await testPool.execute(
      `SELECT event_id, status, attempt_count
       FROM outbox_events
       WHERE event_id IN (?, ?)`,
      [delayedEventId, processingEventId],
    );
    expect(remainingEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_id: delayedEventId,
          status: "pending",
          attempt_count: 0,
        }),
        expect.objectContaining({
          event_id: processingEventId,
          status: "processing",
          attempt_count: 0,
        }),
      ]),
    );
  });

  it("returns an empty batch when there are no due pending events", async () => {
    await insertTestEvent({
      retryAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    await expect(repository.claimPendingBatch()).resolves.toEqual([]);
  });

  it("creates a pending event using the supplied transaction connection", async () => {
    const connection = await testPool.getConnection();
    let transactionStarted = false;
    let eventId;

    try {
      await connection.beginTransaction();
      transactionStarted = true;

      eventId = await repository.createPendingEvent(
        {
          eventType: "test.transactional",
          aggregateType: testAggregateType,
          aggregateId: 1,
          payload: { source: "integration-test" },
        },
        connection,
      );

      const [events] = await connection.execute(
        `SELECT event_id, event_type, aggregate_type, aggregate_id, payload, status
         FROM outbox_events
         WHERE event_id = ?`,
        [eventId],
      );
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        event_id: eventId,
        event_type: "test.transactional",
        aggregate_type: testAggregateType,
        aggregate_id: 1,
        status: "pending",
      });
      expect(events[0].payload).toEqual({ source: "integration-test" });

      await connection.rollback();
      transactionStarted = false;

      const [persistedEvents] = await testPool.execute(
        "SELECT event_id FROM outbox_events WHERE event_id = ?",
        [eventId],
      );
      expect(persistedEvents).toHaveLength(0);
    } finally {
      if (transactionStarted) {
        await connection.rollback();
      }
      connection.release();
    }
  });

  it("marks a processing event as completed", async () => {
    const eventId = await insertTestEvent({ status: "processing" });

    await expect(repository.markCompleted(eventId)).resolves.toBe(true);

    const [events] = await testPool.execute(
      `SELECT status, processing_started_at, processed_at, last_error
       FROM outbox_events
       WHERE event_id = ?`,
      [eventId],
    );
    expect(events[0]).toMatchObject({
      status: "completed",
      processing_started_at: null,
      last_error: null,
    });
    expect(events[0].processed_at).not.toBeNull();
  });

  it("returns an event to pending with retry time based on NOW()", async () => {
    const eventId = await insertTestEvent({ status: "processing" });
    const delaySeconds = 120;
    const lastError = "Temporary email provider failure";

    await expect(
      repository.markRetry(eventId, { delaySeconds, lastError }),
    ).resolves.toBe(true);

    const [events] = await testPool.execute(
      `SELECT status,
              TIMESTAMPDIFF(SECOND, NOW(), next_retry_at) AS retry_delay_seconds,
              processing_started_at,
              processed_at,
              last_error
       FROM outbox_events
       WHERE event_id = ?`,
      [eventId],
    );
    expect(events[0]).toMatchObject({
      status: "pending",
      processing_started_at: null,
      processed_at: null,
      last_error: lastError,
    });
    expect(events[0].retry_delay_seconds).toBeGreaterThanOrEqual(
      delaySeconds - 1,
    );
    expect(events[0].retry_delay_seconds).toBeLessThanOrEqual(delaySeconds);
  });

  it("marks a processing event as failed with the last error", async () => {
    const eventId = await insertTestEvent({ status: "processing" });
    const lastError = "Permanent email provider failure";

    await expect(
      repository.markFailed(eventId, { lastError }),
    ).resolves.toBe(true);

    const [events] = await testPool.execute(
      `SELECT status, processing_started_at, last_error
       FROM outbox_events
       WHERE event_id = ?`,
      [eventId],
    );
    expect(events[0]).toMatchObject({
      status: "failed",
      processing_started_at: null,
      last_error: lastError,
    });
  });

  it("rejects status updates for events that are not processing", async () => {
    const eventId = await insertTestEvent();

    await expect(repository.markCompleted(eventId)).rejects.toMatchObject({
      code: OUTBOX_ERROR_CODES.EVENT_NOT_PROCESSING,
      eventId,
    });
  });

  it("rejects invalid retry details", async () => {
    const eventId = await insertTestEvent({ status: "processing" });

    await expect(
      repository.markRetry(eventId, {
        delaySeconds: 0,
        lastError: "Temporary failure",
      }),
    ).rejects.toThrow("delaySeconds must be a positive safe integer");
    await expect(
      repository.markRetry(eventId, {
        delaySeconds: 30,
        lastError: " ",
      }),
    ).rejects.toThrow("lastError must be a non-empty string");
  });

  it("rejects an empty error when marking an event failed", async () => {
    const eventId = await insertTestEvent({ status: "processing" });

    await expect(
      repository.markFailed(eventId, { lastError: "" }),
    ).rejects.toThrow("lastError must be a non-empty string");
  });

  it("skips a pending event locked by another transaction", async () => {
    const lockedEventId = await insertTestEvent();
    const availableEventId = await insertTestEvent();

    await testPool.execute(
      `UPDATE outbox_events
       SET created_at = DATE_SUB(NOW(), INTERVAL 2 MINUTE)
       WHERE event_id = ?`,
      [lockedEventId],
    );
    await testPool.execute(
      `UPDATE outbox_events
       SET created_at = DATE_SUB(NOW(), INTERVAL 1 MINUTE)
       WHERE event_id = ?`,
      [availableEventId],
    );

    const lockConnection = await testPool.getConnection();

    try {
      await lockConnection.beginTransaction();
      const [lockedRows] = await lockConnection.execute(
        `SELECT id
         FROM outbox_events
         WHERE event_id = ?
         FOR UPDATE`,
        [lockedEventId],
      );
      expect(lockedRows).toHaveLength(1);

      const claimedEvents = await repository.claimPendingBatch(1);

      expect(claimedEvents.map(({ event_id }) => event_id)).toEqual([
        availableEventId,
      ]);

      const [eventStates] = await testPool.execute(
        `SELECT event_id, status, attempt_count
         FROM outbox_events
         WHERE event_id IN (?, ?)`,
        [lockedEventId, availableEventId],
      );
      expect(eventStates).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event_id: lockedEventId,
            status: "pending",
            attempt_count: 0,
          }),
          expect.objectContaining({
            event_id: availableEventId,
            status: "processing",
            attempt_count: 1,
          }),
        ]),
      );
    } finally {
      await lockConnection.rollback();
      lockConnection.release();
    }
  });

  it("requeues only processing events older than the timeout", async () => {
    const staleEventId = await insertTestEvent({ status: "processing" });
    const activeEventId = await insertTestEvent({ status: "processing" });
    const pendingEventId = await insertTestEvent();

    await testPool.execute(
      `UPDATE outbox_events
       SET processing_started_at = DATE_SUB(NOW(), INTERVAL 2 MINUTE)
       WHERE event_id = ?`,
      [staleEventId],
    );
    await testPool.execute(
      `UPDATE outbox_events
       SET processing_started_at = NOW()
       WHERE event_id = ?`,
      [activeEventId],
    );

    await expect(repository.recoverStaleProcessing(60)).resolves.toBe(true);

    const [events] = await testPool.execute(
      `SELECT event_id,
              status,
              processing_started_at,
              last_error,
              next_retry_at <= NOW() AS retry_is_due
       FROM outbox_events
       WHERE event_id IN (?, ?, ?)`,
      [staleEventId, activeEventId, pendingEventId],
    );
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_id: staleEventId,
          status: "pending",
          processing_started_at: null,
          last_error: OUTBOX_PROCESSING_TIMEOUT_ERROR,
          retry_is_due: 1,
        }),
        expect.objectContaining({
          event_id: activeEventId,
          status: "processing",
          last_error: null,
        }),
        expect.objectContaining({
          event_id: pendingEventId,
          status: "pending",
          last_error: null,
        }),
      ]),
    );
    expect(
      events.find(({ event_id }) => event_id === activeEventId)
        .processing_started_at,
    ).not.toBeNull();
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "60"])(
    "rejects invalid recovery timeout %s",
    async (timeout) => {
      await expect(repository.recoverStaleProcessing(timeout)).rejects.toThrow(
        "timeout must be a positive safe integer in seconds",
      );
    },
  );

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "10"])(
    "rejects invalid batch size %s",
    async (batchSize) => {
      await expect(repository.claimPendingBatch(batchSize)).rejects.toThrow(
        "batchSize must be a positive safe integer",
      );
    },
  );
});
