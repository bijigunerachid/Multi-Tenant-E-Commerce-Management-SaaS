import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Badge, Card, PageHeader, SkeletonRows } from '../../components/ui/layout.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { getApiError } from '../../lib/apiClient.js';
import { formatDate } from '../../lib/format.js';
import { ROLE_LABELS } from '../../lib/roles.js';
import { useSession } from '../auth/useSession.js';
import {
  disableUser,
  enableUser,
  getAdminUser,
  resendUserVerification,
  resetUserMfa,
  signOutUser,
} from '../../services/adminService.js';
import { ReasonDialog } from './ReasonDialog.jsx';
import { UserBadges } from './AdminUsersPage.jsx';

export function AdminUserPage() {
  const { userId } = useParams();
  const { data: session } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState(null); // 'status' | 'signOut' | 'mfa'
  const key = ['admin', 'user', userId];
  const user = useQuery({ queryKey: key, queryFn: () => getAdminUser(userId) });
  const resend = useMutation({
    mutationFn: () => resendUserVerification(userId),
    onSuccess: () => toast.success('Confirmation email sent.'),
    onError: (e) => toast.error(getApiError(e).message),
  });
  const done = (message, updated) => {
    if (updated?.id) queryClient.setQueryData(key, updated);
    queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    queryClient.invalidateQueries({ queryKey: ['admin', 'activity'] });
    setDialog(null);
    toast.success(message);
  };

  if (user.isPending) return <SkeletonRows rows={6} label="Loading user" />;
  if (user.isError) return <Alert tone="error">{getApiError(user.error).message}</Alert>;
  const u = user.data;
  const isSelf = u.id === session.user.id;
  const isAdmin = u.platformRole === 'SUPER_ADMIN';
  const disabled = u.status === 'DISABLED';
  const ownsActive = u.memberships.filter((m) => m.role === 'OWNER' && m.status === 'ACTIVE');

  return (
    <>
      <PageHeader title={u.name} description={u.email} />
      <div className="space-y-6">
        <Card title="Account">
          <dl className="grid gap-4 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-ink-500">Status</dt>
              <dd className="mt-1 flex flex-wrap gap-2">
                {disabled ? (
                  <Badge tone="danger">Disabled</Badge>
                ) : (
                  <Badge tone="success">Active</Badge>
                )}
                <UserBadges user={{ ...u, status: 'ACTIVE' }} />
              </dd>
            </div>
            <div>
              <dt className="text-ink-500">Created</dt>
              <dd className="mt-1 text-ink-900">{formatDate(u.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-ink-500">Last sign-in</dt>
              <dd className="mt-1 text-ink-900">
                {u.lastSignInAt ? formatDate(u.lastSignInAt) : 'Never'}
              </dd>
            </div>
          </dl>
        </Card>

        <Card
          title="Actions"
          description={
            isSelf
              ? 'This is your account: manage it from your profile.'
              : isAdmin
                ? 'Platform administrators are managed from the server (npm run admin).'
                : 'Each action is recorded in the platform activity log with your reason.'
          }
        >
          {!isSelf && !isAdmin && (
            <div className="space-y-4">
              {!disabled && ownsActive.length > 0 && (
                <Alert tone="warning">
                  This user owns {ownsActive.map((m) => m.organization.name).join(', ')}. Disabling
                  them leaves{' '}
                  {ownsActive.length === 1 ? 'that organization' : 'those organizations'} without an
                  owner who can sign in.
                </Alert>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  variant={disabled ? 'primary' : 'danger'}
                  onClick={() => setDialog('status')}
                >
                  {disabled ? 'Enable account' : 'Disable account'}
                </Button>
                {!disabled && (
                  <Button variant="secondary" onClick={() => setDialog('signOut')}>
                    Sign out everywhere
                  </Button>
                )}
                {u.mfaEnabled && (
                  <Button variant="secondary" onClick={() => setDialog('mfa')}>
                    Reset two-factor sign-in
                  </Button>
                )}
                {!u.emailVerified && !disabled && (
                  <Button
                    variant="secondary"
                    loading={resend.isPending}
                    onClick={() => resend.mutate()}
                  >
                    Resend confirmation email
                  </Button>
                )}
              </div>
            </div>
          )}
        </Card>

        <Card title="Organizations">
          {u.memberships.length === 0 ? (
            <p className="text-sm text-ink-600">Not a member of any organization.</p>
          ) : (
            <ul className="-mx-5 -my-4 divide-y divide-ink-100">
              {u.memberships.map((m) => (
                <li
                  key={m.id}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-3 text-sm"
                >
                  <Link
                    to={`/admin/organizations/${m.organization.id}`}
                    className="font-medium text-ink-900 hover:text-brand-600"
                  >
                    {m.organization.name}
                  </Link>
                  <span className="flex items-center gap-2 text-ink-600">
                    {ROLE_LABELS[m.role]}
                    {m.status !== 'ACTIVE' && <Badge>Deactivated</Badge>}
                    {m.organization.status === 'SUSPENDED' && (
                      <Badge tone="danger">Suspended</Badge>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <ReasonDialog
        open={dialog === 'status'}
        onClose={() => setDialog(null)}
        title={disabled ? `Enable ${u.name}?` : `Disable ${u.name}?`}
        description={
          disabled
            ? 'They can sign in again with their password.'
            : 'They are signed out everywhere at once and cannot sign in until enabled again. Their data and memberships stay.'
        }
        confirmLabel={disabled ? 'Enable account' : 'Disable account'}
        tone={disabled ? 'primary' : 'danger'}
        run={(reason) => (disabled ? enableUser(u.id, reason) : disableUser(u.id, reason))}
        onDone={(updated) => done(disabled ? 'Account enabled.' : 'Account disabled.', updated)}
      />
      <ReasonDialog
        open={dialog === 'signOut'}
        onClose={() => setDialog(null)}
        title={`Sign ${u.name} out everywhere?`}
        description="Every session of this account ends now. They can sign in again."
        confirmLabel="Sign out everywhere"
        run={(reason) => signOutUser(u.id, reason)}
        onDone={({ sessionsEnded }) =>
          done(`${sessionsEnded} ${sessionsEnded === 1 ? 'session' : 'sessions'} ended.`)
        }
      />
      <ReasonDialog
        open={dialog === 'mfa'}
        onClose={() => setDialog(null)}
        title={`Reset two-factor sign-in for ${u.name}?`}
        description="For someone who lost their phone and recovery codes. Confirm their identity first. They are signed out and can sign in with their password, then set it up again."
        confirmLabel="Reset two-factor sign-in"
        tone="danger"
        run={(reason) => resetUserMfa(u.id, reason)}
        onDone={(updated) => done('Two-factor sign-in reset.', updated)}
      />
    </>
  );
}
