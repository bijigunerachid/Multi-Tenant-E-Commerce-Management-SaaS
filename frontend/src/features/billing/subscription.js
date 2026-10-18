// Shared wording for subscription states, used by the banner and the Billing page.

export const STATUS_LABELS = {
  TRIALING: { label: 'Trial', tone: 'accent' },
  ACTIVE: { label: 'Active', tone: 'success' },
  PAST_DUE: { label: 'Payment due', tone: 'warning' },
  CANCELED: { label: 'Canceled', tone: 'danger' },
  EXPIRED: { label: 'Trial ended', tone: 'danger' },
};

/** Whole days left until `date` (0 on the last day), or null without a date. */
export function daysLeft(date, now = Date.now()) {
  if (!date) return null;
  return Math.max(0, Math.ceil((new Date(date).getTime() - now) / 86_400_000));
}

export const RESOURCE_LABELS = {
  stores: 'Active stores',
  members: 'Members',
  products: 'Products',
};
export const FEATURE_LABELS = { csvExport: 'CSV exports' };

const NOUNS = {
  stores: ['active store', 'active stores'],
  members: ['member', 'members'],
  products: ['product', 'products'],
};
/** "1 active store", "1,000 products". */
export const countOf = (resource, n) => `${n.toLocaleString()} ${NOUNS[resource][n === 1 ? 0 : 1]}`;
