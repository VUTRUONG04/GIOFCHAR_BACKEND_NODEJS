import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EMAIL_TIMEOUT_MS } from "../../src/constants/email.js";
import ResendProvider from "../../src/services/email/ResendProvider.js";

describe("ResendProvider.send", () => {
  let provider;

  beforeEach(() => {
    provider = new ResendProvider({
      apiKey: "test-api-key",
      from: "Giofchar <no-reply@example.com>",
    });
    provider.resend.emails.send = vi.fn().mockResolvedValue({
      data: { id: "email-message-id" },
      error: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends to one valid address with a required idempotency key", async () => {
    await expect(
      provider.send({
        to: " customer@example.com ",
        subject: "Order received",
        html: "<p>Thank you</p>",
        idempotencyKey: " order-created/123 ",
      }),
    ).resolves.toEqual({ providerMessageId: "email-message-id" });

    expect(provider.resend.emails.send).toHaveBeenCalledWith(
      {
        from: "Giofchar <no-reply@example.com>",
        to: "customer@example.com",
        subject: "Order received",
        html: "<p>Thank you</p>",
      },
      expect.objectContaining({
        idempotencyKey: "order-created/123",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("accepts and normalizes a list of valid recipient addresses", async () => {
    await provider.send({
      to: [" first@example.com ", "second@example.com"],
      idempotencyKey: "order-created/123",
    });

    expect(provider.resend.emails.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ["first@example.com", "second@example.com"],
      }),
      expect.objectContaining({
        idempotencyKey: "order-created/123",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("aborts the request on timeout and marks the error retryable", async () => {
    vi.useFakeTimers();
    let requestSignal;

    provider.resend.emails.send.mockImplementation(
      (_payload, { signal }) =>
        new Promise((resolve) => {
          requestSignal = signal;
          signal.addEventListener(
            "abort",
            () =>
              resolve({
                data: null,
                error: {
                  name: "application_error",
                  message: "Unable to fetch data.",
                },
              }),
            { once: true },
          );
        }),
    );

    const sendPromise = provider.send({
      to: "customer@example.com",
      idempotencyKey: "order-created/123",
    });
    const assertion = expect(sendPromise).rejects.toMatchObject({
      name: "EmailProviderError",
      message: "Unable to fetch data.",
      retryable: true,
    });

    await vi.advanceTimersByTimeAsync(EMAIL_TIMEOUT_MS);
    await assertion;

    expect(requestSignal.aborted).toBe(true);
  });

  it("maps a thrown AbortError to a retryable timeout error", async () => {
    const abortError = new Error("The operation was aborted");
    abortError.name = "AbortError";
    provider.resend.emails.send.mockRejectedValue(abortError);

    await expect(
      provider.send({
        to: "customer@example.com",
        idempotencyKey: "order-created/123",
      }),
    ).rejects.toMatchObject({
      name: "EmailProviderError",
      message: "Email request timeout",
      retryable: true,
      cause: abortError,
    });
  });

  it.each([
    undefined,
    "",
    "not-an-email",
    "missing-domain@",
    [],
    ["first@example.com", ""],
    ["first@example.com", "invalid-address"],
    123,
  ])("rejects invalid recipient input: %s", async (to) => {
    await expect(
      provider.send({ to, idempotencyKey: "order-created/123" }),
    ).rejects.toThrow(TypeError);

    expect(provider.resend.emails.send).not.toHaveBeenCalled();
  });

  it.each([undefined, null, "", "   ", 123])(
    "rejects an invalid idempotency key: %s",
    async (idempotencyKey) => {
      await expect(
        provider.send({ to: "customer@example.com", idempotencyKey }),
      ).rejects.toThrow(TypeError);

      expect(provider.resend.emails.send).not.toHaveBeenCalled();
    },
  );

  it("rejects idempotency keys longer than 256 characters", async () => {
    await expect(
      provider.send({
        to: "customer@example.com",
        idempotencyKey: "a".repeat(257),
      }),
    ).rejects.toThrow(RangeError);

    expect(provider.resend.emails.send).not.toHaveBeenCalled();
  });
});
