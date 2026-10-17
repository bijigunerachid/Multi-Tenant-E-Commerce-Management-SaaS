// Option lists for currency and time zone pickers, built from the browser's Intl data so they
// match what the API accepts (it validates against the same Intl lists in Node).

const currencyNames = new Intl.DisplayNames(['en'], { type: 'currency' });

export const CURRENCY_OPTIONS = Intl.supportedValuesOf('currency').map((code) => ({
  value: code,
  label: `${code} · ${currencyNames.of(code)}`,
}));

export const TIMEZONE_OPTIONS = [
  'UTC',
  ...Intl.supportedValuesOf('timeZone').filter((tz) => tz !== 'UTC'),
].map((tz) => ({ value: tz, label: tz.replaceAll('_', ' ') }));

export function browserTimeZone() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return TIMEZONE_OPTIONS.some((o) => o.value === tz) ? tz : 'UTC';
}

// Countries, from the browser's own region names. The API validates against the same rule.
const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
const NOT_COUNTRIES = new Set(['EU', 'EZ', 'UN', 'QO', 'XA', 'XB', 'ZZ']);
const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export const COUNTRY_OPTIONS = [...letters]
  .flatMap((a) => [...letters].map((b) => a + b))
  .filter((code) => !NOT_COUNTRIES.has(code) && regionNames.of(code) !== code)
  .map((code) => ({ value: code, label: regionNames.of(code) }))
  .sort((x, y) => x.label.localeCompare(y.label));

export const countryName = (code) => (code ? (regionNames.of(code) ?? code) : '');
