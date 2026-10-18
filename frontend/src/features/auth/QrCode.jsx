import { useMemo } from 'react';
import qrcode from 'qrcode-generator';

/**
 * A QR code drawn as one SVG path (no image, no third-party request). `qrcode-generator` only
 * computes the pattern; error correction level M survives a slightly blurry phone camera.
 */
export function QrCode({ value, label, className = 'size-44' }) {
  const { size, path } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(value);
    qr.make();
    const count = qr.getModuleCount();
    let d = '';
    for (let row = 0; row < count; row += 1) {
      for (let col = 0; col < count; col += 1) {
        if (qr.isDark(row, col)) d += `M${col + 4} ${row + 4}h1v1h-1z`;
      }
    }
    // A 4-module quiet zone around the code, as scanners expect.
    return { size: count + 8, path: d };
  }, [value]);

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      className={`rounded-md bg-white ring-1 ring-ink-200 ${className}`}
    >
      <rect width={size} height={size} fill="#ffffff" />
      <path d={path} fill="#18211e" />
    </svg>
  );
}
