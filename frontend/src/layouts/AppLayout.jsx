import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useMatches, useNavigate } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import {
  ArchiveBoxIcon,
  Bars3Icon,
  ChartBarIcon,
  BuildingOfficeIcon,
  ChevronDoubleLeftIcon,
  ChevronDoubleRightIcon,
  ChevronUpDownIcon,
  CreditCardIcon,
  EnvelopeIcon,
  CubeIcon,
  HomeIcon,
  ShoppingBagIcon,
  TagIcon,
  UserCircleIcon,
  UserGroupIcon,
  UsersIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { CheckIcon, PlusIcon } from '@heroicons/react/20/solid';
import { Logo } from './AuthLayout.jsx';
import { useDismiss } from '../hooks/useDismiss.js';
import { NotificationBell } from '../features/notifications/NotificationBell.jsx';
import { SubscriptionBanner } from '../features/billing/SubscriptionBanner.jsx';
import { useApplySession, useSession } from '../features/auth/useSession.js';
import { logout } from '../services/authService.js';
import { switchOrganization } from '../services/organizationService.js';
import { useToast } from '../components/ui/Toast.jsx';
import { getApiError } from '../lib/apiClient.js';
import { ROLE_LABELS } from '../lib/roles.js';

// Navigation lists only pages that exist. Later steps add inventory, customers, orders, etc.
const NAV = [
  {
    to: '/',
    label: (permissions) => (permissions.includes('report:read') ? 'Dashboard' : 'Overview'),
    icon: HomeIcon,
    end: true,
  },
  { to: '/products', label: 'Products', icon: CubeIcon, permission: 'product:read' },
  { to: '/categories', label: 'Categories', icon: TagIcon, permission: 'product:read' },
  { to: '/inventory', label: 'Inventory', icon: ArchiveBoxIcon, permission: 'inventory:read' },
  { to: '/orders', label: 'Orders', icon: ShoppingBagIcon, permission: 'order:read' },
  { to: '/customers', label: 'Customers', icon: UserGroupIcon, permission: 'customer:read' },
  { to: '/reports', label: 'Reports', icon: ChartBarIcon, permission: 'report:read' },
  { to: '/employees', label: 'Employees', icon: UsersIcon, permission: 'member:read' },
  { to: '/settings/organization', label: 'Organization', icon: BuildingOfficeIcon },
  { to: '/settings/billing', label: 'Billing', icon: CreditCardIcon, permission: 'billing:read' },
  { to: '/settings/emails', label: 'Email log', icon: EnvelopeIcon, permission: 'audit:read' },
  { to: '/settings/profile', label: 'Your profile', icon: UserCircleIcon },
];

function SidebarNav({ collapsed, permissions, onNavigate }) {
  return (
    <nav aria-label="Main" className="flex-1 space-y-1 px-2 py-4">
      {NAV.filter((item) => !item.permission || permissions.includes(item.permission))
        .map((item) => ({
          ...item,
          label: typeof item.label === 'function' ? item.label(permissions) : item.label,
        }))
        .map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            title={collapsed ? item.label : undefined}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-md px-2.5 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-indigo-600 ${
                isActive
                  ? 'bg-indigo-50 text-indigo-700'
                  : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
              }`
            }
          >
            <item.icon aria-hidden="true" className="size-5 shrink-0" />
            <span className={collapsed ? 'sr-only' : ''}>{item.label}</span>
          </NavLink>
        ))}
    </nav>
  );
}

function OrganizationSwitcher({ session }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, setOpen);
  const navigate = useNavigate();
  const applySession = useApplySession();
  const toast = useToast();
  const active = session.activeOrganization;

  const switchTo = useMutation({
    mutationFn: switchOrganization,
    onSuccess: (s) => {
      applySession(s);
      setOpen(false);
      navigate('/');
      toast.success(`Switched to ${s.activeOrganization.name}.`);
    },
    onError: (e) => toast.error(getApiError(e).message),
  });

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex max-w-[16rem] items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-indigo-600"
      >
        <span className="min-w-0">
          <span className="block truncate font-medium text-slate-900">{active.name}</span>
          <span className="block text-xs text-slate-500">{ROLE_LABELS[active.role]}</span>
        </span>
        <ChevronUpDownIcon aria-hidden="true" className="size-4 shrink-0 text-slate-400" />
        <span className="sr-only">Switch organization</span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 z-30 mt-1 w-72 rounded-md bg-white py-1 shadow-lg ring-1 ring-slate-200"
        >
          <p className="px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">
            Organizations
          </p>
          {session.organizations
            .filter((o) => o.status === 'ACTIVE')
            .map((org) => (
              <button
                key={org.id}
                type="button"
                role="menuitem"
                disabled={switchTo.isPending}
                onClick={() => (org.id === active.id ? setOpen(false) : switchTo.mutate(org.id))}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50 disabled:opacity-60"
              >
                <span className="min-w-0">
                  <span className="block truncate text-slate-900">{org.name}</span>
                  <span className="block text-xs text-slate-500">{ROLE_LABELS[org.role]}</span>
                </span>
                {org.id === active.id && (
                  <CheckIcon aria-hidden="true" className="size-4 text-indigo-600" />
                )}
              </button>
            ))}
          <div className="my-1 border-t border-slate-100" />
          <Link
            role="menuitem"
            to="/organizations/new"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            <PlusIcon aria-hidden="true" className="size-4" /> Create organization
          </Link>
        </div>
      )}
    </div>
  );
}

function UserMenu({ user }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, setOpen);
  const navigate = useNavigate();
  const applySession = useApplySession();
  const signOut = useMutation({
    mutationFn: logout,
    onSettled: () => {
      applySession(null);
      navigate('/login', { replace: true });
    },
  });
  const initials = user.name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
      >
        <span
          aria-hidden="true"
          className="grid size-8 place-items-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700"
        >
          {initials}
        </span>
        <span className="sr-only">Open user menu</span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-2 w-56 rounded-md bg-white py-1 shadow-lg ring-1 ring-slate-200"
        >
          <div className="px-3 py-2">
            <p className="truncate text-sm font-medium text-slate-900">{user.name}</p>
            <p className="truncate text-xs text-slate-500">{user.email}</p>
          </div>
          <div className="my-1 border-t border-slate-100" />
          <Link
            role="menuitem"
            to="/settings/profile"
            onClick={() => setOpen(false)}
            className="block px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            Your profile
          </Link>
          <Link
            role="menuitem"
            to="/notifications"
            onClick={() => setOpen(false)}
            className="block px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            Notifications
          </Link>
          {user.platformRole === 'SUPER_ADMIN' && (
            <Link
              role="menuitem"
              to="/admin"
              onClick={() => setOpen(false)}
              className="block px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              Platform admin
            </Link>
          )}
          <button
            role="menuitem"
            type="button"
            disabled={signOut.isPending}
            onClick={() => signOut.mutate()}
            className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function Breadcrumbs() {
  const crumbs = useMatches()
    .filter((m) => m.handle?.crumb)
    .map((m) => ({ label: m.handle.crumb, path: m.pathname }));
  if (crumbs.length === 0) return null;
  return (
    <nav aria-label="Breadcrumb" className="mb-4 text-sm text-slate-500">
      <ol className="flex flex-wrap items-center gap-1.5">
        {crumbs.map((c, i) => (
          <li key={c.path} className="flex items-center gap-1.5">
            {i > 0 && <span aria-hidden="true">/</span>}
            {i === crumbs.length - 1 ? (
              <span aria-current="page" className="text-slate-700">
                {c.label}
              </span>
            ) : (
              <Link to={c.path} className="hover:text-slate-700">
                {c.label}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

const COLLAPSE_KEY = 'vendora.sidebarCollapsed';

export function AppLayout() {
  const { data: session } = useSession();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const permissions = session.activeOrganization.permissions;

  useEffect(() => setMobileOpen(false), [location.pathname]);
  const toggleCollapsed = () => {
    setCollapsed((v) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, v ? '0' : '1');
      } catch {
        // Preference only; ignore storage failures.
      }
      return !v;
    });
  };

  return (
    <div className="min-h-screen">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2"
      >
        Skip to content
      </a>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-slate-900/40"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative flex h-full w-64 flex-col bg-white shadow-xl">
            <div className="flex h-16 items-center justify-between px-4">
              <Logo />
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="rounded-md p-1 text-slate-500 hover:bg-slate-100"
              >
                <XMarkIcon aria-hidden="true" className="size-6" />
                <span className="sr-only">Close menu</span>
              </button>
            </div>
            <SidebarNav
              collapsed={false}
              permissions={permissions}
              onNavigate={() => setMobileOpen(false)}
            />
          </div>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 hidden flex-col border-r border-slate-200 bg-white lg:flex ${collapsed ? 'w-16' : 'w-64'}`}
      >
        <div className="flex h-16 items-center px-4">
          {collapsed ? (
            <span
              aria-hidden="true"
              className="grid size-8 place-items-center rounded-md bg-indigo-600 text-base font-bold text-white"
            >
              V
            </span>
          ) : (
            <Logo />
          )}
        </div>
        <SidebarNav collapsed={collapsed} permissions={permissions} />
        <button
          type="button"
          onClick={toggleCollapsed}
          className="m-2 flex items-center gap-3 rounded-md px-2.5 py-2 text-sm text-slate-500 hover:bg-slate-100"
        >
          {collapsed ? (
            <ChevronDoubleRightIcon aria-hidden="true" className="size-5" />
          ) : (
            <ChevronDoubleLeftIcon aria-hidden="true" className="size-5" />
          )}
          <span className={collapsed ? 'sr-only' : ''}>
            {collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          </span>
        </button>
      </aside>

      <div className={collapsed ? 'lg:pl-16' : 'lg:pl-64'}>
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur sm:px-6">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden"
          >
            <Bars3Icon aria-hidden="true" className="size-6" />
            <span className="sr-only">Open menu</span>
          </button>
          <OrganizationSwitcher session={session} />
          <div className="ml-auto flex items-center gap-2">
            <NotificationBell organizationId={session.activeOrganization.id} />
            <UserMenu user={session.user} />
          </div>
        </header>
        <main id="main" className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
          <SubscriptionBanner
            subscription={session.activeOrganization.subscription}
            canManageBilling={permissions.includes('billing:read')}
          />
          <Breadcrumbs />
          <Outlet />
        </main>
      </div>
    </div>
  );
}
