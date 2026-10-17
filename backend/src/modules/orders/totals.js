import { Prisma } from '@prisma/client';

const { Decimal } = Prisma;
const ZERO = new Decimal(0);

/**
 * Order totals, computed with exact decimals (never floats):
 *   line total = unit price × quantity
 *   subtotal   = Σ line totals
 *   tax        = (subtotal − discount) × tax rate, rounded half-up to 2 decimals
 *   total      = subtotal − discount + tax + shipping
 * The same formula is enforced by a CHECK constraint on the orders table.
 */
export function computeTotals({ lines, discountTotal = '0', shippingTotal = '0', taxRate = '0' }) {
  const priced = lines.map((line) => ({
    ...line,
    unitPrice: new Decimal(line.unitPrice),
    lineTotal: new Decimal(line.unitPrice).mul(line.quantity),
  }));
  const subtotal = priced.reduce((sum, line) => sum.add(line.lineTotal), ZERO);
  const discount = new Decimal(discountTotal);
  const shipping = new Decimal(shippingTotal);
  const rate = new Decimal(taxRate);

  if (discount.greaterThan(subtotal)) {
    return {
      error: { field: 'discountTotal', message: 'The discount cannot exceed the subtotal' },
    };
  }
  const taxTotal = subtotal.sub(discount).mul(rate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const total = subtotal.sub(discount).add(taxTotal).add(shipping);

  return {
    lines: priced,
    subtotal,
    discountTotal: discount,
    taxRate: rate,
    taxTotal,
    shippingTotal: shipping,
    total,
  };
}
