import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// Time-based one-time passwords (RFC 6238) as authenticator apps compute them: HMAC-SHA1,
// 6 digits, 30-second steps. Built on node:crypto rather than a dependency; checked against
// the RFC's test vectors in totp.test.js.

const STEP_SECONDS = 30;
const DIGITS = 6;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text) {
  const clean = text.replace(/[\s=-]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) throw new Error('Invalid base32');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new secret: 160 random bits, base32, as authenticator apps expect. */
export function generateSecret() {
  return base32Encode(randomBytes(20));
}

/** HOTP (RFC 4226) for one counter value. */
export function hotp(secretBase32, counter, digits = DIGITS) {
  const key = base32Decode(secretBase32);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', key).update(message).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, '0');
}

export const currentStep = (now = Date.now()) => Math.floor(now / 1000 / STEP_SECONDS);

export function totp(secretBase32, now = Date.now()) {
  return hotp(secretBase32, currentStep(now));
}

/**
 * Checks a code against the current step and one step either side (clock drift). Returns the
 * matching step, or null. Codes for steps at or before `notAfterStep` are refused, so a code
 * that was already used (or an older one) cannot be replayed.
 */
export function verifyTotp(secretBase32, code, { now = Date.now(), notAfterStep = null } = {}) {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return null;
  const step = currentStep(now);
  for (const candidate of [step - 1, step, step + 1]) {
    if (notAfterStep !== null && candidate <= notAfterStep) continue;
    const expected = Buffer.from(hotp(secretBase32, candidate));
    if (timingSafeEqual(expected, Buffer.from(code))) return candidate;
  }
  return null;
}

/** The link authenticator apps read from the QR code. */
export function otpauthUrl({ secret, account, issuer = 'Vendora' }) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params}`;
}
