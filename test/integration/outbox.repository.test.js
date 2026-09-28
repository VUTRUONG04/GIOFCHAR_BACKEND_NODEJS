import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import mysql from "mysql2/promise";
import { randomUUID } from "node:crypto";

import OutboxRepository from "../../src/repositories/outbox.repository.js";

const testAggregateType = "test_outbox_repository";
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

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "10"])(
    "rejects invalid batch size %s",
    async (batchSize) => {
      await expect(repository.claimPendingBatch(batchSize)).rejects.toThrow(
        "batchSize must be a positive safe integer",
      );
    },
  );
});
