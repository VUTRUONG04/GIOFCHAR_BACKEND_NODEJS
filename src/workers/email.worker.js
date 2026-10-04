import buildEmail from "../services/email/buildEmail.js";

class EmailWorker {
  constructor(provider) {
    this.provider = provider;
  }

  async execute({
    event_id,
    event_type,
    payload,
    status,
  }) {
    if (status !== "processing") {
      return false;
    }

    const { subject, html } = buildEmail(event_type, payload);

    return this.provider.send({
      to: payload.email,
      subject,
      html,
      idempotencyKey: event_id,
    });
  }
}

export default EmailWorker;
