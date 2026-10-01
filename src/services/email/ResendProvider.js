import { Resend } from "resend";

import EmailProviderError from "../../errors/EmailProviderError.js";
import EmailProvider from "./emailProvider.js";

class ResendProvider extends EmailProvider {
    constructor({ apiKey = "", from = "" } = {}) {
        super();
        this.apiKey = apiKey;
        this.from = from;
        this.resend = new Resend(this.apiKey);
    }

    isResendRetryable(error) {
        return ['rate_limit_exceeded', 'application_error', 'service_unavailable', 'resource_locked', 'concurrent_idempotent_requests'].includes(error.name);
    }

    async send({
        to = "",
        subject = "",
        html = "",
        idempotencyKey = "",
    } = {}) {
        const { data, error } = await this.resend.emails.send(
            { from: this.from, to, subject, html },
            { idempotencyKey },
        );

        if (error) {
            throw new EmailProviderError(error.message, {
                retryable: this.isResendRetryable(error),
                cause: error
            });
        }

        return { providerMessageId: data.id };
    }
}

export default ResendProvider;