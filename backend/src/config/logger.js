import pino from 'pino';

export function createLogger({ level }) {
  return pino({
    level,
    // Never write credentials or session material to the logs.
    redact: {
      paths: [
        'req.headers.cookie',
        'req.headers.authorization',
        'req.headers["x-csrf-token"]',
        'res.headers["set-cookie"]',
        '*.password',
        '*.token',
      ],
      censor: '[redacted]',
    },
  });
}
