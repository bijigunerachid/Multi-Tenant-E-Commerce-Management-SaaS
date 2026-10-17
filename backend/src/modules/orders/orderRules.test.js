import { ACTIONS, STATUSES, TRANSITIONS, allowedActions, canTransition } from './stateMachine.js';
import { computeTotals } from './totals.js';

describe('order state machine', () => {
  // The complete table: every (status, action) pair is listed, so any change to the
  // lifecycle has to be made here deliberately.
  const EXPECTED = {
    DRAFT: ['place'],
    PENDING: ['confirm', 'cancel'],
    CONFIRMED: ['start', 'cancel'],
    PROCESSING: ['ship', 'cancel'],
    SHIPPED: ['deliver'],
    DELIVERED: [],
    CANCELLED: [],
  };

  test.each(STATUSES)('from %s', (status) => {
    expect(allowedActions(status)).toEqual(EXPECTED[status]);
    for (const action of ACTIONS) {
      expect(canTransition(status, action)).toBe(EXPECTED[status].includes(action));
    }
  });

  test('shipped and delivered orders can never be cancelled', () => {
    expect(TRANSITIONS.cancel.from).not.toContain('SHIPPED');
    expect(TRANSITIONS.cancel.from).not.toContain('DELIVERED');
  });

  test('unknown actions are refused', () => {
    expect(canTransition('PENDING', 'refund')).toBe(false);
  });
});

describe('order totals', () => {
  test('computes lines, tax on the discounted subtotal, and the total exactly', () => {
    const t = computeTotals({
      lines: [
        { unitPrice: '19.99', quantity: 3 },
        { unitPrice: '0.10', quantity: 3 },
      ],
      discountTotal: '5.00',
      shippingTotal: '30',
      taxRate: '0.2',
    });
    expect(t.lines.map((l) => l.lineTotal.toFixed(2))).toEqual(['59.97', '0.30']);
    expect(t.subtotal.toFixed(2)).toBe('60.27');
    expect(t.taxTotal.toFixed(2)).toBe('11.05'); // (60.27 − 5) × 0.2 = 11.054 → 11.05
    expect(t.total.toFixed(2)).toBe('96.32'); // 60.27 − 5 + 11.05 + 30
  });

  test('rounds tax half-up', () => {
    const t = computeTotals({ lines: [{ unitPrice: '0.25', quantity: 1 }], taxRate: '0.1' });
    expect(t.taxTotal.toFixed(2)).toBe('0.03'); // 0.025 → 0.03
  });

  test('does not suffer from floating point errors', () => {
    const t = computeTotals({
      lines: [
        { unitPrice: '0.10', quantity: 1 },
        { unitPrice: '0.20', quantity: 1 },
      ],
    });
    expect(t.total.toFixed(2)).toBe('0.30');
    expect(t.total.equals('0.3')).toBe(true);
  });

  test('refuses a discount larger than the subtotal', () => {
    const t = computeTotals({ lines: [{ unitPrice: '10', quantity: 1 }], discountTotal: '10.01' });
    expect(t.error).toEqual({
      field: 'discountTotal',
      message: 'The discount cannot exceed the subtotal',
    });
  });
});
