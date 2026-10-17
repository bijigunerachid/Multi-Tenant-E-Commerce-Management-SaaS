import { z } from 'zod';

// A short list of very common passwords that satisfy the length rule. A full breached-password
// check (for example the k-anonymity Pwned Passwords API) can replace this later.
const COMMON_PASSWORDS = new Set([
  '1234567890',
  '0123456789',
  '1111111111',
  'aaaaaaaaaa',
  'abcdefghij',
  'password12',
  'password123',
  'password1234',
  'password!!',
  'qwertyuiop',
  'qwerty1234',
  '1q2w3e4r5t',
  '123456789a',
  'iloveyou12',
  'letmein123',
  'welcome123',
  'admin12345',
  'vendora123',
]);

export const emailSchema = z
  .string({ error: 'Enter your email address' })
  .trim()
  .toLowerCase()
  .max(254, 'Email address is too long')
  .pipe(z.email({ error: 'Enter a valid email address' }));

export const passwordSchema = z
  .string({ error: 'Enter a password' })
  .min(10, 'Use at least 10 characters')
  .max(128, 'Use at most 128 characters')
  .refine((value) => !COMMON_PASSWORDS.has(value.toLowerCase()), {
    error: 'This password is too common. Choose another one.',
  });

export const nameSchema = z
  .string({ error: 'Enter a name' })
  .trim()
  .min(1, 'Enter a name')
  .max(120, 'Use at most 120 characters');

/** Tokens we generate are 43 base64url characters; accept a little slack, nothing exotic. */
export const tokenSchema = z
  .string({ error: 'The link is invalid' })
  .regex(/^[A-Za-z0-9_-]{20,128}$/, 'The link is invalid');

export const uuidSchema = z.uuid({ error: 'Invalid identifier' });

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, 'Use at least 2 characters')
  .max(60, 'Use at most 60 characters')
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lower-case letters, numbers and single hyphens');

const TIMEZONES = new Set(Intl.supportedValuesOf('timeZone'));
TIMEZONES.add('UTC');
export const timezoneSchema = z
  .string()
  .refine((value) => TIMEZONES.has(value), { error: 'Choose a valid time zone' });

const CURRENCIES = new Set(Intl.supportedValuesOf('currency'));
export const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine((value) => CURRENCIES.has(value), { error: 'Choose a valid currency' });

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

/** Turns a display name into a URL slug ("Café Nour & Co" → "cafe-nour-co"). */
export function slugify(value) {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/g, '');
}
