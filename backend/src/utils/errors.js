/**
 * An error that is safe to show to API clients. Anything that is not an AppError is
 * reported to the client as a generic 500 and logged in full on the server.
 */
export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (code, message, details) => new AppError(400, code, message, details);
export const unauthorized = (code = 'UNAUTHENTICATED', message = 'Sign in to continue') =>
  new AppError(401, code, message);
export const forbidden = (code = 'FORBIDDEN', message = 'You do not have permission to do this') =>
  new AppError(403, code, message);
export const notFound = (message = 'Resource not found') => new AppError(404, 'NOT_FOUND', message);
export const conflict = (code, message, details) => new AppError(409, code, message, details);

/** Prisma unique-constraint violation, optionally on a specific column. */
export function isUniqueViolation(err, field) {
  if (err?.code !== 'P2002') return false;
  if (!field) return true;
  const target = err.meta?.target;
  return Array.isArray(target) ? target.includes(field) : String(target ?? '').includes(field);
}
