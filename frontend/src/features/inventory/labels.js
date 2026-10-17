export const STOCK_STATUS = {
  OK: { label: 'In stock', tone: 'success' },
  LOW: { label: 'Low stock', tone: 'warning' },
  OUT: { label: 'Out of stock', tone: 'danger' },
};

export const ADJUSTMENT_REASONS = [
  { value: 'COUNT_CORRECTION', label: 'Stock count correction' },
  { value: 'DAMAGED', label: 'Damaged' },
  { value: 'LOST', label: 'Lost or stolen' },
  { value: 'FOUND', label: 'Found' },
  { value: 'RETURNED', label: 'Customer return' },
  { value: 'OTHER', label: 'Other (explain in the note)' },
];
export const REASON_LABELS = Object.fromEntries(ADJUSTMENT_REASONS.map((r) => [r.value, r.label]));

export const MOVEMENT_TYPES = {
  RECEIPT: { label: 'Received', tone: 'success' },
  ADJUSTMENT: { label: 'Adjusted', tone: 'neutral' },
  RESERVE: { label: 'Reserved', tone: 'accent' },
  RELEASE: { label: 'Released', tone: 'neutral' },
  FULFIL: { label: 'Shipped', tone: 'accent' },
};

export const signed = (n) => (n > 0 ? `+${n}` : String(n));
