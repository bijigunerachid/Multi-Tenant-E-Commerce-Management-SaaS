import { Navigate, Outlet, useLocation } from 'react-router';
import { LockClosedIcon } from '@heroicons/react/24/outline';
import { useSession } from '../features/auth/useSession.js';
import { FullPageSpinner } from '../components/ui/Spinner.jsx';
import { Alert, EmptyState } from '../components/ui/layout.jsx';
import { Button } from '../components/ui/Button.jsx';
import { getApiError } from '../lib/apiClient.js';
import { safeNextPath } from '../features/auth/schemas.js';

// These guards decide what to render. They are a convenience, not security: the API checks
// authentication, tenant membership and permissions on every request regardless.

function SessionError({ error, onRetry }) {
  return (
    <div className="mx-auto max-w-md px-4 py-24">
      <Alert
        tone="error"
        title="We could not load your account"
        action={
          <Button size="sm" variant="secondary" onClick={onRetry}>
            Try again
          </Button>
        }
      >
        {getApiError(error).message}
      </Alert>
    </div>
  );
}

/** Signed-in users only. Others go to /login and come back afterwards. */
export function RequireAuth() {
  const session = useSession();
  const location = useLocation();
  if (session.isPending) return <FullPageSpinner />;
  if (session.isError)
    return <SessionError error={session.error} onRetry={() => session.refetch()} />;
  if (!session.data) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  return <Outlet />;
}

/** Signed-in users with an active organization. Others go to onboarding. */
export function RequireOrganization() {
  const { data } = useSession();
  if (!data.activeOrganization) return <Navigate to="/onboarding" replace />;
  return <Outlet />;
}

/** Onboarding is for users without an active organization. */
export function RequireNoOrganization() {
  const { data } = useSession();
  if (data.activeOrganization) return <Navigate to="/" replace />;
  return <Outlet />;
}

/**
 * Pages for signed-out visitors (sign in, register). Signed-in users continue to the page they
 * were trying to reach (?next=, same-site paths only) or home. This also runs right after a
 * successful sign-in, when the new session arrives.
 */
export function GuestOnly() {
  const session = useSession();
  const location = useLocation();
  if (session.isPending) return <FullPageSpinner />;
  if (session.data) {
    const next = safeNextPath(new URLSearchParams(location.search).get('next'));
    // The spinner stays visible while the destination page's code is still downloading.
    return (
      <>
        <FullPageSpinner />
        <Navigate to={next} replace />
      </>
    );
  }
  return <Outlet />;
}

/** Hides a page from roles without the permission, with an explanation instead of a blank page. */
export function RequirePermission({ permission }) {
  const { data } = useSession();
  if (!data.activeOrganization.permissions.includes(permission)) {
    return (
      <EmptyState
        icon={LockClosedIcon}
        title="You do not have access to this page"
        description="Ask an owner of this organization if you need access."
      />
    );
  }
  return <Outlet />;
}
