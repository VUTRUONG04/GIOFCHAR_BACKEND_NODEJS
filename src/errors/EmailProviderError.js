class EmailProviderError extends Error {
    constructor(message, { retryable = false, cause = null } = {}) {
        super(message);

        this.name = "EmailProviderError";
        this.retryable = retryable;
        this.cause = cause;
    }
}

export default EmailProviderError;