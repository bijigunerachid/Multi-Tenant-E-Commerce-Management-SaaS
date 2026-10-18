import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { renderRoute, sessionFixture } from '../../tests/renderWithProviders.jsx';
import * as authService from '../../services/authService.js';
import * as adminService from '../../services/adminService.js';
import * as orgService from '../../services/organizationService.js';

vi.mock('../../services/authService.js');
vi.mock('../../services/adminService.js');
vi.mock('../../services/organizationService.js');

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const REASON = 'Ticket 4182: owner asked for more time';

function adminSession({ admin = true } = {}) {
  const s = sessionFixture();
  s.user.platformRole = admin ? 'SUPER_ADMIN' : 'NONE';
  s.user.mfaEnabled = admin;
  return s;
}

const organization = (overrides = {}) => ({
  id: ORG_ID,
  name: 'Atlas Outfitters',
  slug: 'atlas-outfitters',
  status: 'ACTIVE',
  suspendedAt: null,
  suspendedReason: null,
  createdAt: '2026-09-01T10:00:00Z',
  subscription: {
    status: 'EXPIRED',
    plan: { code: 'growth', name: 'Growth', priceMonthly: '79.00' },
    trialEndsAt: '2026-10-01T10:00:00Z',
    billedByProvider: false,
    providerCustomerId: null,
  },
  usage: { stores: 1, members: 2, products: 14, orders: 30 },
  members: [
    {
      id: 'm1',
      name: 'Amina Haddad',
      email: 'amina@example.com',
      role: 'OWNER',
      status: 'ACTIVE',
      userStatus: 'ACTIVE',
    },
  ],
  recentInvoices: [],
  failedWebhooks: 0,
  ...overrides,
});

beforeEach(() => {
  vi.mocked(authService.getSession).mockResolvedValue(adminSession());
  vi.mocked(adminService.getPlatformStats).mockResolvedValue({
    organizations: { total: 12, active: 11, suspended: 1, createdLast30Days: 4 },
    users: { total: 40, createdLast30Days: 9 },
    subscriptionsByStatus: { TRIALING: 5, ACTIVE: 6, EXPIRED: 1 },
    subscriptionsByPlan: [],
    monthlyRecurringRevenue: [{ currency: 'USD', amount: '474.00', subscriptions: 6 }],
    trialsEndingIn7Days: 2,
    failedWebhooks: 0,
  });
  vi.mocked(adminService.listAllOrganizations).mockResolvedValue({
    data: [
      {
        id: ORG_ID,
        name: 'Atlas Outfitters',
        slug: 'atlas-outfitters',
        status: 'SUSPENDED',
        createdAt: '2026-09-01T10:00:00Z',
        planCode: 'growth',
        planName: 'Growth',
        subscriptionStatus: 'EXPIRED',
        memberCount: 2,
        owner: { name: 'Amina Haddad', email: 'amina@example.com' },
      },
    ],
    meta: { page: 1, pageSize: 25, total: 1 },
  });
  vi.mocked(adminService.getAdminOrganization).mockResolvedValue(organization());
});

describe('access', () => {
  test('other users get no admin page and no data', async () => {
    vi.mocked(authService.getSession).mockResolvedValue(adminSession({ admin: false }));
    renderRoute('/admin');
    expect(await screen.findByText('You do not have access to this page')).toBeVisible();
    expect(adminService.getPlatformStats).not.toHaveBeenCalled();
  });

  test('administrators find the admin area in the user menu', async () => {
    renderRoute('/settings/profile');
    await userEvent.click(await screen.findByRole('button', { name: 'Open user menu' }));
    expect(screen.getByRole('menuitem', { name: 'Platform admin' })).toHaveAttribute(
      'href',
      '/admin',
    );
  });
});

describe('overview', () => {
  test('shows platform figures and the organizations', async () => {
    renderRoute('/admin');
    expect(await screen.findByRole('heading', { level: 1, name: 'Platform' })).toBeVisible();
    const tile = (label) => screen.getByText(label, { selector: 'dt' }).closest('div');
    await screen.findByText('Monthly recurring revenue');
    expect(tile('Organizations')).toHaveTextContent('1 suspended · 4 new in 30 days');
    expect(tile('Monthly recurring revenue')).toHaveTextContent(/474\.00/);
    expect(tile('Trials')).toHaveTextContent('2 ending within 7 days · 1 expired');

    const row = await screen.findByRole('link', { name: /Atlas Outfitters/ });
    expect(row).toHaveAttribute('href', `/admin/organizations/${ORG_ID}`);
    expect(row).toHaveTextContent('amina@example.com');
    expect(within(row).getByText('Suspended')).toBeVisible();
    expect(within(row).getByText('Trial ended')).toBeVisible();
  });

  test('search and filters go to the URL and the API', async () => {
    const { router } = renderRoute('/admin');
    await screen.findByRole('link', { name: /Atlas Outfitters/ });
    await userEvent.selectOptions(screen.getByLabelText('Organization status'), 'Suspended');
    await userEvent.type(screen.getByLabelText('Search organizations'), 'amina');
    await waitFor(() =>
      expect(adminService.listAllOrganizations).toHaveBeenLastCalledWith({
        page: 1,
        pageSize: 25,
        search: 'amina',
        status: 'SUSPENDED',
      }),
    );
    expect(router.state.location.search).toBe('?status=SUSPENDED&search=amina');
  });
});

describe('an organization', () => {
  test('suspending asks for a reason and warns when Stripe still bills it', async () => {
    vi.mocked(adminService.getAdminOrganization).mockResolvedValue(
      organization({
        subscription: { ...organization().subscription, status: 'ACTIVE', billedByProvider: true },
      }),
    );
    vi.mocked(adminService.suspendOrganization).mockResolvedValue(
      organization({ status: 'SUSPENDED', suspendedReason: REASON }),
    );
    renderRoute(`/admin/organizations/${ORG_ID}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Suspend' }));
    const dialog = await screen.findByRole('dialog', { name: 'Suspend Atlas Outfitters?' });
    expect(within(dialog).getByText(/Stripe keeps billing/)).toBeVisible();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Suspend organization' }));
    expect(await within(dialog).findByText('Give a reason (at least 5 characters)')).toBeVisible();
    expect(adminService.suspendOrganization).not.toHaveBeenCalled();

    await userEvent.type(within(dialog).getByLabelText('Reason'), REASON);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Suspend organization' }));
    await waitFor(() =>
      expect(adminService.suspendOrganization).toHaveBeenCalledWith(ORG_ID, REASON),
    );
    expect(await screen.findByText('Atlas Outfitters suspended.')).toBeVisible();
    expect(await screen.findByRole('button', { name: 'Reactivate' })).toBeVisible();
  });

  test('a trial is extended to the end of the chosen day', async () => {
    vi.mocked(adminService.changeOrganizationSubscription).mockResolvedValue(organization());
    renderRoute(`/admin/organizations/${ORG_ID}`);
    expect(await screen.findByText('Not paying')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Change' }));
    const dialog = await screen.findByRole('dialog', { name: 'Change subscription' });
    await userEvent.type(within(dialog).getByLabelText('Last day of the trial'), '2026-11-30');
    await userEvent.type(within(dialog).getByLabelText('Reason'), REASON);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(adminService.changeOrganizationSubscription).toHaveBeenCalledWith(ORG_ID, {
        plan: 'growth',
        status: 'TRIALING',
        reason: REASON,
        trialEndsAt: new Date('2026-11-30T23:59:59').toISOString(),
      }),
    );
  });

  test('a subscription paid through Stripe cannot be changed here', async () => {
    vi.mocked(adminService.getAdminOrganization).mockResolvedValue(
      organization({
        subscription: {
          ...organization().subscription,
          status: 'ACTIVE',
          billedByProvider: true,
          providerCustomerId: 'cus_test_9',
        },
      }),
    );
    renderRoute(`/admin/organizations/${ORG_ID}`);
    expect(await screen.findByText(/Stripe \(cus_test_9\)/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Change' })).not.toBeInTheDocument();
  });

  test('the audit log opens only once a reason is given', async () => {
    vi.mocked(adminService.getOrganizationAuditLogs).mockResolvedValue({
      data: [
        {
          id: 'a1',
          action: 'invitation.created',
          actor: { email: 'amina@example.com' },
          metadata: null,
          createdAt: '2026-10-10T10:00:00Z',
        },
      ],
      meta: { page: 1, pageSize: 20, total: 1 },
    });
    renderRoute(`/admin/organizations/${ORG_ID}`);
    const button = await screen.findByRole('button', { name: 'Show audit log' });
    await userEvent.click(button);
    expect(await screen.findByText('Give a reason (at least 5 characters)')).toBeVisible();
    expect(adminService.getOrganizationAuditLogs).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText('Why do you need to read it?'), REASON);
    await userEvent.click(button);
    expect(await screen.findByText('invitation.created')).toBeVisible();
    expect(adminService.getOrganizationAuditLogs).toHaveBeenCalledWith(ORG_ID, {
      reason: REASON,
      page: 1,
      pageSize: 20,
    });
  });
});

describe('members of a suspended organization', () => {
  test('are told what happened and can open their other organizations', async () => {
    const s = sessionFixture({ role: 'MANAGER', permissions: ['org:read'] });
    s.activeOrganization.status = 'SUSPENDED';
    s.organizations = [
      { ...s.organizations[0], status: 'SUSPENDED' },
      { id: 'org-2', name: 'Casablanca Ceramics', slug: 'cc', status: 'ACTIVE', role: 'OWNER' },
    ];
    vi.mocked(authService.getSession).mockResolvedValue(s);
    vi.mocked(orgService.switchOrganization).mockResolvedValue(sessionFixture());
    const { router } = renderRoute('/products');

    expect(
      await screen.findByRole('heading', { name: 'Atlas Outfitters is suspended' }),
    ).toBeVisible();
    expect(screen.getByText(/Ask its owner/)).toBeVisible();
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open Casablanca Ceramics' }));
    await waitFor(() => expect(orgService.switchOrganization).toHaveBeenCalledWith('org-2'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });
});

describe('platform control', () => {
  const USER_ID = '22222222-2222-4222-8222-222222222222';
  const person = (overrides = {}) => ({
    id: USER_ID,
    name: 'Karim Tazi',
    email: 'karim@example.com',
    status: 'ACTIVE',
    emailVerified: true,
    platformRole: 'NONE',
    mfaEnabled: true,
    createdAt: '2026-09-01T10:00:00Z',
    lastSignInAt: '2026-10-17T09:00:00Z',
    memberships: [
      {
        id: 'm1',
        role: 'OWNER',
        status: 'ACTIVE',
        organization: { id: ORG_ID, name: 'Atlas Outfitters', status: 'ACTIVE' },
      },
    ],
    ...overrides,
  });

  test('administrators without two-factor sign-in are sent to set it up', async () => {
    const s = adminSession();
    s.user.mfaEnabled = false;
    vi.mocked(authService.getSession).mockResolvedValue(s);
    renderRoute('/admin/users');
    expect(await screen.findByText('Turn on two-factor sign-in first')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Set it up in your profile' })).toHaveAttribute(
      'href',
      '/settings/profile',
    );
    expect(adminService.listUsers).not.toHaveBeenCalled();
  });

  test('lists users with what matters at a glance', async () => {
    vi.mocked(adminService.listUsers).mockResolvedValue({
      data: [{ ...person(), status: 'DISABLED', emailVerified: false, organizations: 2 }],
      meta: { page: 1, pageSize: 25, total: 1 },
    });
    renderRoute('/admin/users');
    const row = await screen.findByRole('link', { name: /Karim Tazi/ });
    expect(row).toHaveAttribute('href', `/admin/users/${USER_ID}`);
    expect(row).toHaveTextContent('2 organizations');
    for (const badge of ['Disabled', 'Email not confirmed', 'Two-factor']) {
      expect(within(row).getByText(badge)).toBeVisible();
    }
    expect(screen.getByRole('navigation', { name: 'Admin' })).toBeVisible();
  });

  test('disabling an owner warns about their organization and needs a reason', async () => {
    vi.mocked(adminService.getAdminUser).mockResolvedValue(person());
    vi.mocked(adminService.disableUser).mockResolvedValue(person({ status: 'DISABLED' }));
    renderRoute(`/admin/users/${USER_ID}`);
    expect(await screen.findByText(/owns Atlas Outfitters/)).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Disable account' }));
    const dialog = await screen.findByRole('dialog', { name: 'Disable Karim Tazi?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Disable account' }));
    expect(await within(dialog).findByText('Give a reason (at least 5 characters)')).toBeVisible();
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Fraud report 5120');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Disable account' }));
    await waitFor(() =>
      expect(adminService.disableUser).toHaveBeenCalledWith(USER_ID, 'Fraud report 5120'),
    );
    expect(await screen.findByText('Account disabled.')).toBeVisible();
    expect(await screen.findByRole('button', { name: 'Enable account' })).toBeVisible();
  });

  test('offers no actions on another administrator', async () => {
    vi.mocked(adminService.getAdminUser).mockResolvedValue(
      person({ platformRole: 'SUPER_ADMIN', memberships: [] }),
    );
    renderRoute(`/admin/users/${USER_ID}`);
    expect(await screen.findByText(/managed from the server/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Disable account' })).not.toBeInTheDocument();
  });

  test('the activity log says who did what, where, and why', async () => {
    vi.mocked(adminService.listPlatformActivity).mockResolvedValue({
      data: [
        {
          id: 'a1',
          action: 'admin.user_disabled',
          reason: 'Fraud report 5120',
          actor: { email: 'staff@vendora.example' },
          organization: null,
          user: { id: USER_ID, email: 'karim@example.com' },
          createdAt: '2026-10-18T09:00:00Z',
        },
        {
          id: 'a2',
          action: 'platform.admin_granted',
          reason: null,
          actor: null,
          organization: null,
          user: { id: 'u2', email: 'staff@vendora.example' },
          createdAt: '2026-10-17T09:00:00Z',
        },
      ],
      meta: { page: 1, pageSize: 30, total: 2 },
    });
    renderRoute('/admin/activity');
    const first = (await screen.findByText('Disabled an account', { selector: 'p' })).closest('li');
    expect(first).toHaveTextContent('staff@vendora.example on karim@example.com');
    expect(first).toHaveTextContent('“Fraud report 5120”');
    const second = screen
      .getByText('Platform admin role granted (server)', { selector: 'p' })
      .closest('li');
    expect(second).toHaveTextContent('Server command line for staff@vendora.example');
  });
});
