import { formatMoney } from '../../lib/format.js';

/** What each notification type is called in settings. */
export const TYPE_LABELS = {
  'order.placed': {
    label: 'New orders',
    description: 'An order is placed in any of your stores.',
  },
  'inventory.low_stock': {
    label: 'Low stock',
    description: 'A product variant falls to its low-stock threshold or runs out.',
  },
};

/** Text and link for one notification: { title, body, href, tone }. */
export function describeNotification({ type, data }) {
  if (type === 'order.placed') {
    const items = `${data.itemCount} ${data.itemCount === 1 ? 'item' : 'items'}`;
    return {
      title: `New order #${data.number}`,
      body: `${items}, ${formatMoney(data.total, data.currency)} · ${data.storeName}`,
      href: `/orders/${data.orderId}`,
      tone: 'info',
    };
  }
  if (type === 'inventory.low_stock') {
    const out = data.status === 'OUT';
    const name = `${data.productName} (${data.variantName})`;
    return {
      title: `${out ? 'Out of stock' : 'Low stock'}: ${data.sku}`,
      body: out
        ? `${name} is out of stock at ${data.storeName}.`
        : `${name}: ${data.available} left at ${data.storeName} (alert at ${data.threshold}).`,
      href: `/inventory?storeId=${data.storeId}&search=${encodeURIComponent(data.sku)}`,
      tone: out ? 'danger' : 'warning',
    };
  }
  return { title: 'Notification', body: '', href: '/notifications', tone: 'neutral' };
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const absolute = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** "2 minutes ago", "yesterday"; older than a week: the date. */
export function timeAgo(value, now = Date.now()) {
  const seconds = Math.round((new Date(value).getTime() - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 60) return 'just now';
  if (abs < 3600) return relative.format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return relative.format(Math.round(seconds / 3600), 'hour');
  if (abs < 7 * 86_400) return relative.format(Math.round(seconds / 86_400), 'day');
  return absolute.format(new Date(value));
}
