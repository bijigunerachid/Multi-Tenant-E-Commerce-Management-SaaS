import { base32Decode, base32Encode, hotp, otpauthUrl, totp, verifyTotp } from './totp.js';
import { createSecretBox } from './secretBox.js';

// RFC 6238 appendix B: the SHA-1 secret is the ASCII string "12345678901234567890".
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('TOTP', () => {
  test.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ])('matches the RFC 6238 test vector at %i s', (seconds, expected) => {
    expect(hotp(RFC_SECRET, Math.floor(seconds / 30), 8)).toBe(expected);
  });

  test('base32 round-trips and ignores spaces and case', () => {
    const bytes = Buffer.from('any secret bytes!');
    expect(
      base32Decode(
        base32Encode(bytes)
          .toLowerCase()
          .replace(/(.{4})/g, '$1 '),
      ),
    ).toEqual(bytes);
  });

  test('accepts the current code and one step of clock drift, never a replay', () => {
    const now = 1_790_000_000_000;
    const code = totp(RFC_SECRET, now);
    const step = verifyTotp(RFC_SECRET, code, { now });
    expect(step).toBe(Math.floor(now / 30_000));
    expect(verifyTotp(RFC_SECRET, code, { now: now + 30_000 })).toBe(step); // 30 s late: ok
    expect(verifyTotp(RFC_SECRET, code, { now: now + 90_000 })).toBeNull(); // too late
    expect(verifyTotp(RFC_SECRET, code, { now, notAfterStep: step })).toBeNull(); // replay
    expect(verifyTotp(RFC_SECRET, '12345', { now })).toBeNull();
    expect(verifyTotp(RFC_SECRET, 'abcdef', { now })).toBeNull();
  });

  test('the setup link carries the secret, issuer and account', () => {
    const url = new URL(otpauthUrl({ secret: 'ABC', account: 'amina@example.com' }));
    expect(url.protocol).toBe('otpauth:');
    expect(url.host).toBe('totp');
    expect(decodeURIComponent(url.pathname)).toBe('/Vendora:amina@example.com');
    expect(url.searchParams.get('secret')).toBe('ABC');
    expect(url.searchParams.get('issuer')).toBe('Vendora');
  });
});

describe('secret box', () => {
  test('encrypts with a fresh IV each time and detects tampering', () => {
    const box = createSecretBox(Buffer.alloc(32, 7).toString('base64'));
    const a = box.seal('JBSWY3DPEHPK3PXP');
    const b = box.seal('JBSWY3DPEHPK3PXP');
    expect(a).not.toBe(b);
    expect(a).not.toContain('JBSWY3DPEHPK3PXP');
    expect(box.open(a)).toBe('JBSWY3DPEHPK3PXP');

    const parts = a.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => box.open(parts.join('.'))).toThrow();
    // Another key cannot open it.
    expect(() => createSecretBox(Buffer.alloc(32, 8).toString('base64')).open(a)).toThrow();
  });

  test('refuses keys of the wrong size', () => {
    expect(() => createSecretBox(Buffer.alloc(16).toString('base64'))).toThrow(/32 bytes/);
  });
});
