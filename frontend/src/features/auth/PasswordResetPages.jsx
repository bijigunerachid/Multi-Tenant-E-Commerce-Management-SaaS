import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { AuthLayout, linkClass } from '../../layouts/AuthLayout.jsx';
import { TextField } from '../../components/ui/fields.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Alert } from '../../components/ui/layout.jsx';
import { useServerErrors } from '../../hooks/useServerErrors.js';
import { requestPasswordReset, resetPassword } from '../../services/authService.js';
import { forgotPasswordSchema, resetPasswordSchema } from './schemas.js';

const backToSignIn = (
  <Link to="/login" className={linkClass}>
    Back to sign in
  </Link>
);

export function ForgotPasswordPage() {
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });
  const [formError, handleError] = useServerErrors(setError);
  const mutation = useMutation({ mutationFn: requestPasswordReset, onError: handleError });

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="We will email you a link to choose a new password."
      footer={backToSignIn}
    >
      {mutation.isSuccess ? (
        <Alert tone="success" title="Check your email">
          If an account exists for {mutation.variables.email}, a reset link is on its way. It
          expires in 30 minutes.
        </Alert>
      ) : (
        <form noValidate onSubmit={handleSubmit((v) => mutation.mutate(v))} className="space-y-5">
          {formError && <Alert tone="error">{formError}</Alert>}
          <TextField
            label="Email"
            type="email"
            autoComplete="email"
            error={errors.email?.message}
            {...register('email')}
          />
          <Button type="submit" className="w-full" loading={mutation.isPending}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: '', confirmPassword: '' },
  });
  const [formError, handleError] = useServerErrors(setError);
  const mutation = useMutation({
    mutationFn: ({ password }) => resetPassword({ token, password }),
    onError: handleError,
  });

  if (!token) {
    return (
      <AuthLayout title="Reset your password" footer={backToSignIn}>
        <Alert tone="error">
          This link is incomplete. Open the link from the email again, or request a new one.
        </Alert>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Choose a new password" footer={backToSignIn}>
      {mutation.isSuccess ? (
        <Alert tone="success" title="Password changed">
          You have been signed out everywhere.{' '}
          <Link to="/login" className={linkClass}>
            Sign in with your new password
          </Link>
          .
        </Alert>
      ) : (
        <form noValidate onSubmit={handleSubmit((v) => mutation.mutate(v))} className="space-y-5">
          {formError && (
            <Alert tone="error">
              {formError}{' '}
              <Link to="/forgot-password" className={linkClass}>
                Request a new link
              </Link>
            </Alert>
          )}
          <TextField
            label="New password"
            type="password"
            autoComplete="new-password"
            hint="At least 10 characters."
            error={errors.password?.message}
            {...register('password')}
          />
          <TextField
            label="Confirm new password"
            type="password"
            autoComplete="new-password"
            error={errors.confirmPassword?.message}
            {...register('confirmPassword')}
          />
          <Button type="submit" className="w-full" loading={mutation.isPending}>
            Change password
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
