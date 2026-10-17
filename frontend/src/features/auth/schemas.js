import { z } from 'zod';

// Client-side mirrors of the API rules, for immediate feedback. The API remains the authority
// (it also rejects common passwords and duplicate emails; those errors come back per field).

export const emailField = z
  .string()
  .trim()
  .min(1, 'Enter your email address')
  .pipe(z.email({ error: 'Enter a valid email address' }));

export const newPasswordField = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(128, 'Use at most 128 characters');

export const nameField = z
  .string()
  .trim()
  .min(1, 'Enter a name')
  .max(120, 'Use at most 120 characters');

export const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1, 'Enter your password'),
});

export const registerSchema = z.object({
  name: nameField,
  email: emailField,
  password: newPasswordField,
});

export const forgotPasswordSchema = z.object({ email: emailField });

export const resetPasswordSchema = z
  .object({ password: newPasswordField, confirmPassword: z.string() })
  .refine((v) => v.password === v.confirmPassword, {
    path: ['confirmPassword'],
    error: 'The passwords do not match',
  });

/** Only same-site relative paths are accepted as a post-login destination (no open redirect). */
export function safeNextPath(value) {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.startsWith('/\\')
  ) {
    return '/';
  }
  return value;
}
