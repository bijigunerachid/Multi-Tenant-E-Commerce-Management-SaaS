// Order lifecycle (see docs/architecture.md, "Order state machine").
//
//   DRAFT --place--> PENDING --confirm--> CONFIRMED --start--> PROCESSING --ship--> SHIPPED --deliver--> DELIVERED
//                       \___________________\_____________________\____cancel____> CANCELLED
//
// Stock effects: place reserves every line; cancel releases the reservations; ship consumes
// them (on hand and reserved both decrease). Shipped and delivered orders cannot be cancelled.

export const TRANSITIONS = {
  place: { from: ['DRAFT'], to: 'PENDING' },
  confirm: { from: ['PENDING'], to: 'CONFIRMED' },
  start: { from: ['CONFIRMED'], to: 'PROCESSING' },
  ship: { from: ['PROCESSING'], to: 'SHIPPED' },
  deliver: { from: ['SHIPPED'], to: 'DELIVERED' },
  cancel: { from: ['PENDING', 'CONFIRMED', 'PROCESSING'], to: 'CANCELLED' },
};

export const ACTIONS = Object.keys(TRANSITIONS);
export const STATUSES = [
  'DRAFT',
  'PENDING',
  'CONFIRMED',
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
];

export function canTransition(status, action) {
  return Boolean(TRANSITIONS[action]?.from.includes(status));
}

/** Actions available from a status, in lifecycle order. */
export function allowedActions(status) {
  return ACTIONS.filter((action) => canTransition(status, action));
}
