import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { AuthLayout, linkClass } from '../../layouts/AuthLayout.jsx';
import { TextField } from '../../components/ui/fields.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Alert } from '../../components/ui/layout.jsx';
import { useServerErrors } from '../../hooks/useServerErrors.js';
import { login } from '../../services/authService.js';
import { loginSchema, safeNextPath } from './schemas.js';
import { useApplySession } from './useSession.js';

export function LoginPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const applySession = useApplySession();
  const next = safeNextPath(params.get('next'));

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

  const mutation = useMutation({
    mutationFn: login,
    onSuccess: (session) => {
      applySession(session);
      navigate(next, { replace: true });
    },
    onError: handleError,
  });

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
        {formError && <Alert tone="error">{formError}</Alert>}
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
