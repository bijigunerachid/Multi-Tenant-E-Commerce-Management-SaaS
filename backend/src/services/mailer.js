import nodemailer from 'nodemailer';

/**
 * Email provider abstraction. Callers use `send`; the transport is chosen by configuration.
 * - smtp:   real delivery (Mailpit in development, a provider's SMTP relay in production)
 * - memory: messages are kept in `sent` for tests
 *
 * Phase 5 moves delivery onto a BullMQ queue with retries and a delivery history; the
 * interface stays the same.
 */
export function createMailer({ env, logger }) {
  const sent = [];
  const transport =
    env.MAIL_TRANSPORT === 'memory'
      ? nodemailer.createTransport({ jsonTransport: true })
      : nodemailer.createTransport(env.SMTP_URL);

  return {
    sent,
    async send({ to, subject, text, html }) {
      const message = { from: env.MAIL_FROM, to, subject, text, html };
      if (env.MAIL_TRANSPORT === 'memory') {
        sent.push(message);
        return;
      }
      try {
        await transport.sendMail(message);
      } catch (err) {
        // A failed email must not break the request that triggered it (the user can ask for
        // it again). The failure is logged for operators.
        logger.error({ err, subject }, 'Email delivery failed');
      }
    },
  };
}
