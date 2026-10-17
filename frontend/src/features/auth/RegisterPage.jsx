import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { AuthLayout, linkClass } from '../../layouts/AuthLayout.jsx';
import { TextField } from '../../components/ui/fields.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Alert } from '../../components/ui/layout.jsx';
import { useServerErrors } from '../../hooks/useServerErrors.js';
import { register as registerAccount } from '../../services/authService.js';
import { registerSchema } from './schemas.js';
import { useApplySession } from './useSession.js';

export function RegisterPage() {
  const navigate = useNavigate();
  const applySession = useApplySession();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: '', email: '', password: '' },
  });
  const [formError, handleError] = useServerErrors(setError);

  const mutation = useMutation({
    mutationFn: registerAccount,
    onSuccess: (session) => {
      applySession(session);
      navigate('/onboarding', { replace: true });
    },
    onError: handleError,
  });

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Set up Vendora for your business in a few minutes."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className={linkClass}>
            Sign in
          </Link>
        </>
      }
    >
      <form noValidate onSubmit={handleSubmit((v) => mutation.mutate(v))} className="space-y-5">
        {formError && <Alert tone="error">{formError}</Alert>}
        <TextField
          label="Full name"
          autoComplete="name"
          error={errors.name?.message}
          {...register('name')}
        />
        <TextField
          label="Work email"
          type="email"
          autoComplete="email"
          error={errors.email?.message}
          {...register('email')}
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="new-password"
          hint="At least 10 characters."
          error={errors.password?.message}
          {...register('password')}
        />
        <Button type="submit" className="w-full" loading={mutation.isPending}>
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
