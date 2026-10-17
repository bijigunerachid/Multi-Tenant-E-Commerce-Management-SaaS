// Display formatting. Amounts arrive from the API as decimal strings ("19.90"); they are only
// converted to numbers here, for display, never for calculations that are sent back.

const moneyFormats = new Map();

export function formatMoney(amount, currency) {
  if (amount === null || amount === undefined || !currency) return '—';
  if (!moneyFormats.has(currency)) {
    moneyFormats.set(currency, new Intl.NumberFormat(undefined, { style: 'currency', currency }));
  }
  return moneyFormats.get(currency).format(Number(amount));
}

export function formatPriceRange(min, max, currency) {
  if (min === null || min === undefined) return '—';
  return min === max
    ? formatMoney(min, currency)
    : `${formatMoney(min, currency)} – ${formatMoney(max, currency)}`;
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
export const formatDate = (value) => (value ? dateFormat.format(new Date(value)) : '—');

/**
 * A calendar day ("2026-09-01"), not an instant. `new Date('2026-09-01')` is midnight UTC, which
 * is still August 31 west of Greenwich, so the day is read as local midnight instead.
 */
export const formatDay = (day) => (day ? dateFormat.format(new Date(`${day}T00:00:00`)) : '—');

export const PRODUCT_STATUS = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  ACTIVE: { label: 'Active', tone: 'success' },
  ARCHIVED: { label: 'Archived', tone: 'warning' },
};

/** Spending per currency from the API ([{ currency, total }]), e.g. "MAD 1,250.00 + EUR 40.00". */
export function formatSpent(spent) {
  if (!spent || spent.length === 0) return '—';
  return spent.map((s) => formatMoney(s.total, s.currency)).join(' + ');
}
