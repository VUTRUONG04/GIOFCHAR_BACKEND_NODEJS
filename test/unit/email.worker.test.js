import { describe, expect, it, vi } from "vitest";

import EmailWorker from "../../src/workers/email.worker.js";

describe("EmailWorker.execute", () => {
  it("builds and sends the email for a processing event", async () => {
    const provider = {
      send: vi.fn().mockResolvedValue({ providerMessageId: "message-123" }),
    };
    const worker = new EmailWorker(provider);

    await expect(
      worker.execute({
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
      }),
    ).resolves.toEqual({ providerMessageId: "message-123" });

    expect(provider.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "customer@example.com",
        subject: expect.stringContaining("DH-123"),
        idempotencyKey: "event-123",
      }),
    );
    const emailHtml = provider.send.mock.calls[0][0].html;
    expect(emailHtml).toContain("DH-123");
    expect(emailHtml).toContain("0900000000");
    expect(emailHtml).toContain("123 Nguyễn Trãi");
  });

  it("does not send events that are not processing", async () => {
    const provider = { send: vi.fn() };
    const worker = new EmailWorker(provider);

    await expect(
      worker.execute({
        event_id: "event-123",
        event_type: "order.created",
        payload: {},
        status: "pending",
      }),
    ).resolves.toBe(false);

    expect(provider.send).not.toHaveBeenCalled();
  });

  it("propagates provider failures to the outbox caller", async () => {
    const providerError = new Error("Provider unavailable");
    const provider = {
      send: vi.fn().mockRejectedValue(providerError),
    };
    const worker = new EmailWorker(provider);

    await expect(
      worker.execute({
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
      }),
    ).rejects.toBe(providerError);
  });
});
