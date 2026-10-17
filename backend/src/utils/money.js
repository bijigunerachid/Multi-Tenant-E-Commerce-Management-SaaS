import { z } from 'zod';

// Money crosses the API as a decimal string with at most 2 decimals ("19.90"), is stored as
// Decimal(12,2), and is never converted to a JavaScript float on the server.

const MONEY_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;

export const moneySchema = z
  .union([z.string(), z.number()], { error: 'Enter an amount' })
  .transform((value) => (typeof value === 'number' ? String(value) : value.trim()))
  .refine((value) => MONEY_PATTERN.test(value), {
    error: 'Enter an amount like 19.90 (up to 2 decimals)',
  });

/** Prisma Decimal (or null) → "19.90" (or null). */
export function formatMoney(decimal) {
  return decimal === null || decimal === undefined ? null : decimal.toFixed(2);
}
