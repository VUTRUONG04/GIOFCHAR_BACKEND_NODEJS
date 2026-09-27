class EmailProvider {
    async send({
        to,
        subject,
        html,
        idempotencyKey
    }) {
        throw new Error("send() must be implemented");
    }

    async healthCheck() {
        throw new Error("healthCheck() must be implemented");
    }
}

module.exports = EmailProvider;