import { Resend } from "resend";

import { EMAIL_TIMEOUT_MS } from "../../constants/email.js";
import EmailProviderError from "../../errors/EmailProviderError.js";
import EmailProvider from "./emailProvider.js";

const MAX_IDEMPOTENCY_KEY_LENGTH = 256;
const EMAIL_ADDRESS_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class ResendProvider extends EmailProvider {
    constructor({ apiKey = "", from = "" } = {}) {
        super();
        this.apiKey = apiKey;
        this.from = from;
        this.resend = new Resend(this.apiKey);
    }

    isResendRetryable(error) {
        return [
        "rate_limit_exceeded",
        "application_error",
        "service_unavailable",
        "resource_locked",
        "concurrent_idempotent_requests",
        ].includes(error.name);
    }

    async send({ to, subject = "", html = "", idempotencyKey } = {}) {
    const recipients = Array.isArray(to) ? to : [to];
    if (
      recipients.length === 0 ||
      recipients.some(
        (recipient) =>
          typeof recipient !== "string" ||
          !EMAIL_ADDRESS_PATTERN.test(recipient.trim()),
      )
    ) {
      throw new TypeError(
        "to must be a valid email address or a non-empty array of valid email addresses",
      );
    }

    const normalizedTo = Array.isArray(to)
      ? recipients.map((recipient) => recipient.trim())
      : to.trim();

    if (typeof idempotencyKey !== "string" || !idempotencyKey.trim()) {
      throw new TypeError("idempotencyKey must be a non-empty string");
    }

    const normalizedIdempotencyKey = idempotencyKey.trim();
    if (normalizedIdempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
      throw new RangeError(
        `idempotencyKey must not exceed ${MAX_IDEMPOTENCY_KEY_LENGTH} characters`,
      );
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      EMAIL_TIMEOUT_MS,
    );

    try {
        const { data, error } = await this.resend.emails.send(
            { from: this.from, to: normalizedTo, subject, html },
            { 
                idempotencyKey: normalizedIdempotencyKey,
                signal: controller.signal,
            },
        );

        if (error) {
            throw new EmailProviderError(error.message, {
                retryable: this.isResendRetryable(error),
                cause: error,
            });
        }

        return { providerMessageId: data.id };
    } catch (error) {
        if (error instanceof EmailProviderError) {
            throw error;
        }

        if (error?.name === "AbortError") {
            throw new EmailProviderError("Email request timeout", {
                retryable: true,
                cause: error,
            });
        }

        throw new EmailProviderError(
            error?.message || "Unexpected email provider error",
            {
                retryable: false,
                cause: error,
            },
        );
    } finally {
        clearTimeout(timeoutId);
    }
  }
}

export default ResendProvider;