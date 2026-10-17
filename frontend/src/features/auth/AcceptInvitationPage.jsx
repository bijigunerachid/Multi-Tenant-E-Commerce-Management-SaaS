import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { AuthLayout } from '../../layouts/AuthLayout.jsx';
import { TextField } from '../../components/ui/fields.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Alert, SkeletonRows } from '../../components/ui/layout.jsx';
import { useServerErrors } from '../../hooks/useServerErrors.js';
import { getApiError } from '../../lib/apiClient.js';
import { ROLE_LABELS } from '../../lib/roles.js';
import { acceptInvitation, previewInvitation } from '../../services/memberService.js';
import { nameField, newPasswordField } from './schemas.js';
import { useApplySession, useSession } from './useSession.js';

const newAccountSchema = z.object({ name: nameField, password: newPasswordField });

export function AcceptInvitationPage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const navigate = useNavigate();
  const applySession = useApplySession();
  const session = useSession();

  const preview = useQuery({
    queryKey: ['invitation-preview', token, session.data?.user?.id ?? null],
    queryFn: () => previewInvitation(token),
    enabled: Boolean(token) && !session.isPending,
    retry: false,
  });

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(newAccountSchema),
    defaultValues: { name: '', password: '' },
  });
  const [formError, handleError] = useServerErrors(setError);

  const accept = useMutation({
    mutationFn: (body) => acceptInvitation({ token, ...body }),
    onSuccess: (newSession) => {
      applySession(newSession);
      navigate('/', { replace: true });
    },
    onError: handleError,
  });

  if (!token) {
    return (
      <AuthLayout title="Join an organization">
        <Alert tone="error">
          This invitation link is incomplete. Open the link from the email again.
        </Alert>
      </AuthLayout>
    );
  }
  if (preview.isPending) {
    return (
      <AuthLayout title="Join an organization">
        <SkeletonRows rows={2} label="Loading invitation" />
      </AuthLayout>
    );
  }
  if (preview.isError) {
    return (
      <AuthLayout title="Join an organization">
        <Alert tone="error" title="This invitation cannot be used">
          {getApiError(preview.error).message}. Ask the person who invited you to send a new one.
        </Alert>
      </AuthLayout>
    );
  }

  const inv = preview.data;
  const signedIn = Boolean(session.data);
  const nextHere = `/invitations/accept?token=${encodeURIComponent(token)}`;

  return (
    <AuthLayout
      title={`Join ${inv.organizationName}`}
      subtitle={`You have been invited as ${ROLE_LABELS[inv.role]} (${inv.email}).`}
    >
      {formError && (
        <div className="mb-5">
          <Alert tone="error">{formError}</Alert>
        </div>
      )}

      {inv.signedInAsInvitee ? (
        <Button className="w-full" loading={accept.isPending} onClick={() => accept.mutate({})}>
          Accept invitation
        </Button>
      ) : signedIn ? (
        <Alert tone="warning" title="You are signed in with a different account">
          This invitation was sent to {inv.email}. Sign out, then open the link again and sign in
          with that address.
        </Alert>
      ) : inv.accountExists ? (
        <div className="space-y-4">
          <p className="text-sm text-slate-700">
            You already have a Vendora account. Sign in to accept the invitation.
          </p>
          <Link
            to={`/login?next=${encodeURIComponent(nextHere)}`}
            className="inline-flex w-full items-center justify-center rounded-md bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-indigo-500"
          >
            Sign in to accept
          </Link>
        </div>
      ) : (
        <form noValidate onSubmit={handleSubmit((v) => accept.mutate(v))} className="space-y-5">
          <TextField label="Email" value={inv.email} disabled readOnly />
          <TextField
            label="Full name"
            autoComplete="name"
            error={errors.name?.message}
            {...register('name')}
          />
          <TextField
            label="Choose a password"
            type="password"
            autoComplete="new-password"
            hint="At least 10 characters."
            error={errors.password?.message}
            {...register('password')}
          />
          <Button type="submit" className="w-full" loading={accept.isPending}>
            Create account and join
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
