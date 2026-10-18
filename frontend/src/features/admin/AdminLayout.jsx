import { Link, NavLink, Outlet } from 'react-router';
import { ShieldCheckIcon } from '@heroicons/react/24/outline';
import { ArrowLeftIcon } from '@heroicons/react/20/solid';
import { Logo } from '../../layouts/AuthLayout.jsx';
import { EmptyState } from '../../components/ui/layout.jsx';
import { useSession } from '../auth/useSession.js';

/** Platform administrators only. The API checks the role on every request regardless. */
export function RequirePlatformAdmin() {
  const { data } = useSession();
  if (data.user.platformRole !== 'SUPER_ADMIN') {
    return (
      <div className="px-4 py-16">
        <EmptyState
          icon={ShieldCheckIcon}
          title="You do not have access to this page"
          description="This area is for Vendora staff."
        />
      </div>
    );
  }
  // The API refuses admin requests without two-factor sign-in; say so before trying.
  if (!data.user.mfaEnabled) {
    return (
      <div className="px-4 py-16">
        <EmptyState
          icon={ShieldCheckIcon}
          title="Turn on two-factor sign-in first"
          description="The admin area acts on every customer, so it needs a code from your authenticator app on top of your password."
          action={
            <Link
              to="/settings/profile"
              className="inline-flex rounded-md bg-brand-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-brand-500"
            >
              Set it up in your profile
            </Link>
          }
        />
      </div>
    );
  }
  return <Outlet />;
}

const tabClass = ({ isActive }) =>
  `rounded-md px-2.5 py-1.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-brand-600 ${
    isActive ? 'bg-brand-50 text-brand-700' : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900'
  }`;

/**
 * The platform admin area has its own frame: it is not inside any organization, so it has no
 * organization switcher or organization navigation.
 */
export function AdminLayout() {
  const { data: session } = useSession();
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-ink-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6 lg:px-8">
          <Link
            to="/admin"
            className="rounded-md focus-visible:outline-2 focus-visible:outline-brand-600"
          >
            <Logo />
          </Link>
          <span className="rounded-md bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">
            Platform admin
          </span>
          <Link
            to={session.activeOrganization ? '/' : '/onboarding'}
            className="ml-auto inline-flex items-center gap-1.5 text-sm font-medium text-ink-600 hover:text-ink-900"
          >
            <ArrowLeftIcon aria-hidden="true" className="size-4" />
            Back to Vendora
          </Link>
        </div>
        <nav
          aria-label="Admin"
          className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 pb-2 sm:px-6 lg:px-8"
        >
          <NavLink to="/admin" end className={tabClass}>
            Organizations
          </NavLink>
          <NavLink to="/admin/users" className={tabClass}>
            Users
          </NavLink>
          <NavLink to="/admin/activity" className={tabClass}>
            Activity
          </NavLink>
        </nav>
      </header>
      <main id="main" className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        <Outlet />
      </main>
    </div>
  );
}
