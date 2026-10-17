import nodemailer from 'nodemailer';

/**
 * Email provider abstraction, used only by the email worker (requests queue emails instead,
 * see jobs/emailQueue.js). The transport is chosen by configuration:
 * - smtp:   real delivery (Mailpit in development, a provider's SMTP relay in production)
 * - memory: messages are kept in `sent` for tests
 *
 * `send` throws when delivery fails, so the worker can retry it.
 */
export function createMailer({ env }) {
  const sent = [];
  // Memory transport only: errors to throw on the next sends, to test retries and failures.
  const failures = [];
  const transport =
    env.MAIL_TRANSPORT === 'memory' ? null : nodemailer.createTransport(env.SMTP_URL);

  return {
    sent,
    /** Makes the next `times` sends fail with `error` (memory transport, tests only). */
    failNext(error, times = 1) {
      if (env.MAIL_TRANSPORT !== 'memory') throw new Error('failNext needs the memory transport');
      for (let i = 0; i < times; i += 1) failures.push(error);
    },
    /** Forgets sent messages and pending failures (memory transport, between tests). */
    reset() {
      sent.length = 0;
      failures.length = 0;
    },
    async send({ to, subject, text, html }) {
      const message = { from: env.MAIL_FROM, to, subject, text, html };
      if (!transport) {
        if (failures.length) throw failures.shift();
        sent.push(message);
        return { messageId: `memory-${sent.length}` };
      }
      return transport.sendMail(message);
    },
  };
}
