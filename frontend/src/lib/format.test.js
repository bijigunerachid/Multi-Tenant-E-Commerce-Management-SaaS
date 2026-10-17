import { afterAll, expect, test, vi } from 'vitest';

// Run in a zone west of Greenwich, where midnight UTC is still the previous day. The zone is
// set before format.js is loaded, because its date formatter captures the zone when created.
vi.stubEnv('TZ', 'America/New_York');
const { formatDate, formatDay } = await import('./format.js');
afterAll(() => vi.unstubAllEnvs());

test('a calendar day is shown as that day in every time zone', () => {
  const september1 = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(
    new Date(2026, 8, 1),
  );
  expect(formatDay('2026-09-01')).toBe(september1);
  // Why formatDay exists: read as an instant, the same string is August 31 in New York.
  expect(formatDate('2026-09-01')).not.toBe(september1);
  expect(formatDay(null)).toBe('—');
});
