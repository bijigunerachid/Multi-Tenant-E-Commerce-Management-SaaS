import { describe, expect, test } from 'vitest';
import { orderTitle, previewTotals } from './orderLabels.js';

describe('previewTotals', () => {
  test('matches the server formula (tax on the discounted subtotal)', () => {
    expect(
      previewTotals({
        lines: [
          { unitPrice: '29.90', quantity: 2 },
          { unitPrice: '9.50', quantity: 3 },
        ],
        discountTotal: '10',
        shippingTotal: '25',
        taxPercent: '20',
      }),
    ).toEqual({
      subtotal: '88.30',
      discountTotal: '10.00',
      taxTotal: '15.66',
      shippingTotal: '25.00',
      total: '118.96',
    });
  });

  test('does not drift with floating point and ignores invalid input', () => {
    expect(
      previewTotals({
        lines: [
          { unitPrice: '0.10', quantity: 1 },
          { unitPrice: '0.20', quantity: 1 },
        ],
      }).total,
    ).toBe('0.30');
    expect(
      previewTotals({
        lines: [{ unitPrice: '5', quantity: 'abc' }],
        discountTotal: '-3',
        taxPercent: '',
      }).total,
    ).toBe('0.00');
  });

  test('caps the discount at the subtotal in the preview (the server rejects a larger one)', () => {
    expect(
      previewTotals({ lines: [{ unitPrice: '5', quantity: 1 }], discountTotal: '8' }).discountTotal,
    ).toBe('5.00');
  });
});

test('orderTitle', () => {
  expect(orderTitle({ number: 1001 })).toBe('Order #1001');
  expect(orderTitle({ number: null })).toBe('Draft order');
});
