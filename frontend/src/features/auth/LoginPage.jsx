import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { AuthLayout, linkClass } from '../../layouts/AuthLayout.jsx';
import { TextField } from '../../components/ui/fields.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Alert } from '../../components/ui/layout.jsx';
import { useServerErrors } from '../../hooks/useServerErrors.js';
import { getApiError } from '../../lib/apiClient.js';
import { login, verifyMfa } from '../../services/authService.js';
import { loginSchema, safeNextPath } from './schemas.js';
import { useApplySession } from './useSession.js';

const codeSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator app'),
});
const recoverySchema = z.object({
  recoveryCode: z.string().trim().min(10, 'Enter one of your recovery codes'),
});
// The code step is over: the password has to be entered again.
const RESTART_CODES = new Set(['MFA_TOO_MANY_ATTEMPTS', 'MFA_SESSION_EXPIRED', 'UNAUTHENTICATED']);

/** Second step, when two-factor sign-in is on: a code from the app, or a recovery code. */
function CodeStep({ onSignedIn, onRestart }) {
  const [useRecovery, setUseRecovery] = useState(false);
  const field = useRecovery ? 'recoveryCode' : 'code';
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(useRecovery ? recoverySchema : codeSchema),
    defaultValues: { code: '', recoveryCode: '' },
  });
  const [formError, handleError] = useServerErrors(setError);
  const verify = useMutation({
    mutationFn: (values) => verifyMfa({ [field]: values[field] }),
    onSuccess: onSignedIn,
    onError: (e) => {
      const apiError = getApiError(e);
      if (RESTART_CODES.has(apiError.code)) onRestart(apiError.message);
      else handleError(e);
    },
  });

  return (
    <form noValidate onSubmit={handleSubmit((v) => verify.mutate(v))} className="space-y-5">
      {formError && <Alert tone="error">{formError}</Alert>}
      {useRecovery ? (
        <TextField
          key="recovery"
          label="Recovery code"
          hint="One of the codes you saved when you turned on two-factor sign-in. Each works once."
          autoComplete="off"
          spellCheck={false}
          error={errors.recoveryCode?.message}
          {...register('recoveryCode')}
        />
      ) : (
        <TextField
          key="code"
          label="Authentication code"
          hint="Open your authenticator app and enter the 6-digit code for Vendora."
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          error={errors.code?.message}
          {...register('code')}
        />
      )}
      <Button type="submit" className="w-full" loading={verify.isPending}>
        Verify and sign in
      </Button>
      <div className="flex flex-wrap justify-between gap-2 text-sm">
        <button
          type="button"
          className={linkClass}
          onClick={() => {
            reset();
            setUseRecovery((v) => !v);
          }}
        >
          {useRecovery ? 'Use the authenticator app' : 'Use a recovery code instead'}
        </button>
        <button type="button" className={linkClass} onClick={() => onRestart(null)}>
          Start over
        </button>
      </div>
    </form>
  );
}

export function LoginPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const applySession = useApplySession();
  const next = safeNextPath(params.get('next'));
  const [step, setStep] = useState('password');
  const [restartMessage, setRestartMessage] = useState(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });
  const [formError, handleError] = useServerErrors(setError);
  const signedIn = (session) => {
    applySession(session);
    navigate(next, { replace: true });
  };

  const mutation = useMutation({
    mutationFn: login,
    onSuccess: (result) => {
      if (result.mfaRequired) {
        setRestartMessage(null);
        setStep('code');
      } else {
        signedIn(result);
      }
    },
    onError: handleError,
  });

  if (step === 'code') {
    return (
      <AuthLayout title="Two-factor sign-in" subtitle="Your password was right. One more step.">
        <CodeStep
          onSignedIn={signedIn}
          onRestart={(message) => {
            setRestartMessage(message);
            setStep('password');
          }}
        />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Sign in"
      subtitle="Welcome back. Sign in to manage your stores."
      footer={
        <>
          New to Vendora?{' '}
          <Link to="/register" className={linkClass}>
            Create an account
          </Link>
        </>
      }
    >
      <form noValidate onSubmit={handleSubmit((v) => mutation.mutate(v))} className="space-y-5">
        {(formError || restartMessage) && <Alert tone="error">{formError ?? restartMessage}</Alert>}
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          error={errors.email?.message}
          {...register('email')}
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="current-password"
          error={errors.password?.message}
          {...register('password')}
        />
        <div className="flex justify-end">
          <Link to="/forgot-password" className={`text-sm ${linkClass}`}>
            Forgot your password?
          </Link>
        </div>
        <Button type="submit" className="w-full" loading={mutation.isPending}>
          Sign in
        </Button>
      </form>
    </AuthLayout>
  );
}
