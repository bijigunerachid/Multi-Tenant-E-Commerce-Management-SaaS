import { useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { AuthLayout, linkClass } from '../../layouts/AuthLayout.jsx';
import { Alert } from '../../components/ui/layout.jsx';
import { Spinner } from '../../components/ui/Spinner.jsx';
import { getApiError } from '../../lib/apiClient.js';
import { verifyEmail } from '../../services/authService.js';
import { SESSION_KEY } from './useSession.js';

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: verifyEmail,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SESSION_KEY }),
  });

  // Tokens are single use: make sure the request is sent once, even when React runs
  // effects twice in development.
  const sent = useRef(false);
  useEffect(() => {
    if (token && !sent.current) {
      sent.current = true;
      mutation.mutate(token);
    }
  }, [token, mutation]);

  return (
    <AuthLayout title="Confirm your email address">
      {!token ? (
        <Alert tone="error">This link is incomplete. Open the link from the email again.</Alert>
      ) : mutation.isSuccess ? (
        <Alert tone="success" title="Email confirmed">
          <Link to="/" className={linkClass}>
            Continue to Vendora
          </Link>
        </Alert>
      ) : mutation.isError ? (
        <Alert tone="error" title="We could not confirm your email">
          {getApiError(mutation.error).message}. Sign in and ask for a new link from the setup page.
        </Alert>
      ) : (
        <p className="flex items-center gap-2 text-sm text-slate-600">
          <Spinner className="size-4" /> Confirming…
        </p>
      )}
    </AuthLayout>
  );
}
