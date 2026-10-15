import { beforeEach, describe, expect, it, vi } from "vitest";

const { createPendingEvent, getConnection } = vi.hoisted(() => ({
  createPendingEvent: vi.fn(),
  getConnection: vi.fn(),
}));

vi.mock("../../src/config/db.js", () => ({
  default: { getConnection },
}));

vi.mock("../../src/repositories/outbox.repository.js", () => ({
  default: class MockOutboxRepository {
    createPendingEvent(...args) {
      return createPendingEvent(...args);
    }
  },
}));

vi.mock("../../src/services/payment.service.js", () => ({
  default: {
    getByOrderId: vi.fn(),
    updatePaymentById: vi.fn(),
  },
}));

import outboxConstants from "../../src/constants/outbox.cjs";
import orderService from "../../src/services/order.service.js";

const { OUTBOX_EVENT_TYPES } = outboxConstants;

describe("orderService.updateOrder", () => {
  const order = {
    orderId: 42,
    orderCode: "DH2026-000042",
    customerName: "Lan",
    email: "lan@example.com",
    status: "unconfirmed",
  };

  const connection = {
    beginTransaction: vi.fn(),
    execute: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    connection.execute.mockReset();
    connection.beginTransaction.mockResolvedValue();
    connection.commit.mockResolvedValue();
    connection.rollback.mockResolvedValue();
    connection.release.mockImplementation(() => {});
    getConnection.mockResolvedValue(connection);
    createPendingEvent.mockResolvedValue("event-id");
  });

  it("writes an order status email event in the status update transaction", async () => {
    connection.execute
      .mockResolvedValueOnce([[order]])
      .mockResolvedValueOnce([
        [{ orderId: order.orderId, status: order.status }],
      ])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    await orderService.updateOrder(String(order.orderId), "delivering");

    expect(createPendingEvent).toHaveBeenCalledWith(
      {
        eventType: OUTBOX_EVENT_TYPES.ORDER_STATUS_UPDATED,
        aggregateType: "order",
        aggregateId: order.orderId,
        payload: {
          email: order.email,
          orderCode: order.orderCode,
          customerName: order.customerName,
          status: "delivering",
        },
      },
      connection,
    );
    expect(createPendingEvent.mock.invocationCallOrder[0]).toBeLessThan(
      connection.commit.mock.invocationCallOrder[0],
    );
    expect(connection.commit).toHaveBeenCalledOnce();
  });

  it("does not queue an email when the status is unchanged", async () => {
    const alreadyDelivering = { ...order, status: "delivering" };
    connection.execute
      .mockResolvedValueOnce([[alreadyDelivering]])
      .mockResolvedValueOnce([
        [{ orderId: order.orderId, status: alreadyDelivering.status }],
      ])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    await orderService.updateOrder(String(order.orderId), "delivering");

    expect(createPendingEvent).not.toHaveBeenCalled();
    expect(connection.commit).toHaveBeenCalledOnce();
  });

  it("rolls back the status update when the outbox event cannot be recorded", async () => {
    connection.execute
      .mockResolvedValueOnce([[order]])
      .mockResolvedValueOnce([
        [{ orderId: order.orderId, status: order.status }],
      ])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    createPendingEvent.mockRejectedValue(new Error("Outbox insert failed"));

    await expect(
      orderService.updateOrder(String(order.orderId), "delivering"),
    ).rejects.toThrow("Outbox insert failed");

    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.commit).not.toHaveBeenCalled();
  });
});
