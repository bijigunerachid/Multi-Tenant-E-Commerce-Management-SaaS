// Detects the real image type from the file's first bytes ("magic numbers"). The file name and
// the Content-Type sent by the browser are both chosen by the client, so neither is trusted.

const SIGNATURES = [
  {
    mimeType: 'image/jpeg',
    extension: 'jpg',
    matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mimeType: 'image/png',
    extension: 'png',
    matches: (b) =>
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, i) => b[i] === byte),
  },
  {
    mimeType: 'image/webp',
    extension: 'webp',
    matches: (b) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
  },
];

/** Returns { mimeType, extension } for JPEG, PNG or WebP content, otherwise null. */
export function detectImageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  const match = SIGNATURES.find((s) => s.matches(buffer));
  return match ? { mimeType: match.mimeType, extension: match.extension } : null;
}
