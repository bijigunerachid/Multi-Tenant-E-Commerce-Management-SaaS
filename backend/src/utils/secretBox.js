import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

// Encrypts small secrets stored in the database (authenticator secrets) with AES-256-GCM, so a
// copy of the database alone does not let anyone generate sign-in codes. The key comes from
// MFA_ENCRYPTION_KEY (32 bytes, base64), required in production. Outside production a fixed
// development key is used, so local data keeps working across restarts.
//
// Format: "v1.<iv>.<auth tag>.<ciphertext>", each part base64url.

const DEVELOPMENT_KEY = createHash('sha256').update('vendora-development-only-mfa-key').digest();

export function createSecretBox(base64Key) {
  const key = base64Key ? Buffer.from(base64Key, 'base64') : DEVELOPMENT_KEY;
  if (key.length !== 32) throw new Error('MFA_ENCRYPTION_KEY must be 32 bytes, base64-encoded');

  return {
    seal(plaintext) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      return ['v1', iv, cipher.getAuthTag(), data]
        .map((p, i) => (i ? p.toString('base64url') : p))
        .join('.');
    },
    open(sealed) {
      const [version, iv, tag, data] = sealed.split('.');
      if (version !== 'v1') throw new Error('Unknown secret format');
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(data, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    },
  };
}
