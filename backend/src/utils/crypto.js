import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** 32 random bytes, URL-safe. Used for session IDs, CSRF tokens and emailed tokens. */
export function randomToken() {
  return randomBytes(32).toString('base64url');
}

/** Hex SHA-256. Tokens are stored hashed so a database or Redis leak does not expose them. */
export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}
