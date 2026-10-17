export const ORDER_STATUS = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  PENDING: { label: 'Pending', tone: 'warning' },
  CONFIRMED: { label: 'Confirmed', tone: 'accent' },
  PROCESSING: { label: 'Processing', tone: 'accent' },
  SHIPPED: { label: 'Shipped', tone: 'success' },
  DELIVERED: { label: 'Delivered', tone: 'success' },
  CANCELLED: { label: 'Cancelled', tone: 'danger' },
};

/** Primary button label for each forward action, in lifecycle order. */
export const ACTION_LABELS = {
  place: 'Place order',
  confirm: 'Confirm order',
  start: 'Start processing',
  ship: 'Mark as shipped',
  deliver: 'Mark as delivered',
};

export const RESERVATION_LABELS = {
  ACTIVE: 'Reserved',
  CONSUMED: 'Shipped',
  RELEASED: 'Released',
};

export const orderTitle = (order) => (order.number ? `Order #${order.number}` : 'Draft order');

/**
 * Totals preview while editing. Works in integer cents so 0.1 + 0.2 stays 0.30. The server
 * recomputes every amount; this is only what the user sees before saving.
 */
export function previewTotals({ lines, discountTotal, shippingTotal, taxPercent }) {
  const cents = (value) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : 0;
  };
  const subtotal = lines.reduce(
    (sum, l) => sum + cents(l.unitPrice) * (Number(l.quantity) || 0),
    0,
  );
  const discount = Math.min(cents(discountTotal), subtotal);
  const rate = Number(taxPercent) / 100;
  const tax = Number.isFinite(rate) && rate > 0 ? Math.round((subtotal - discount) * rate) : 0;
  const shipping = cents(shippingTotal);
  const toAmount = (c) => (c / 100).toFixed(2);
  return {
    subtotal: toAmount(subtotal),
    discountTotal: toAmount(discount),
    taxTotal: toAmount(tax),
    shippingTotal: toAmount(shipping),
    total: toAmount(subtotal - discount + tax + shipping),
  };
}
