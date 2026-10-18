import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { renderRoute, sessionFixture } from '../../tests/renderWithProviders.jsx';
import * as authService from '../../services/authService.js';
import * as billingService from '../../services/billingService.js';
import * as orgService from '../../services/organizationService.js';
import * as memberService from '../../services/memberService.js';

vi.mock('../../services/authService.js');
vi.mock('../../services/billingService.js');
vi.mock('../../services/organizationService.js');
vi.mock('../../services/memberService.js');

const OWNER = ['org:read', 'org:update', 'member:read', 'member:manage', 'billing:read'];
const inDays = (days) => new Date(Date.now() + days * 86_400_000).toISOString();
const PLANS = [
  ['starter', 'Starter', '29.00', { stores: 1, members: 3, products: 100 }, false],
  ['growth', 'Growth', '79.00', { stores: 3, members: 10, products: 1000 }, true],
  ['scale', 'Scale', '199.00', { stores: 10, members: 50, products: 10000 }, true],
].map(([code, name, priceMonthly, limits, csvExport]) => ({
  code,
  name,
  priceMonthly,
  currency: 'USD',
  limits,
  features: { csvExport },
}));
const STORE = {
  id: 's1',
  name: 'Main store',
  slug: 'main-store',
  currency: 'USD',
  timezone: 'UTC',
  status: 'ACTIVE',
};
const apiError = (status, error) =>
  Object.assign(new Error('Request failed'), { response: { status, data: { error } } });

function session({ role = 'OWNER', permissions = OWNER, subscription } = {}) {
  const s = sessionFixture({ role, permissions });
  s.activeOrganization.subscription = subscription ?? {
    status: 'TRIALING',
    usable: true,
    planName: 'Growth',
    trialEndsAt: inDays(12),
  };
  return s;
}

beforeEach(() => {
  vi.mocked(authService.getSession).mockResolvedValue(session());
  vi.mocked(billingService.listPlans).mockResolvedValue(PLANS);
  vi.mocked(billingService.getSubscription).mockResolvedValue({
    status: 'TRIALING',
    usable: true,
    plan: PLANS[1],
    trialEndsAt: inDays(12),
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    usage: { stores: 3, members: 8, products: 120 },
  });
  vi.mocked(orgService.listStores).mockResolvedValue([STORE]);
  vi.mocked(orgService.getCurrentOrganization).mockResolvedValue({
    id: 'org-1',
    name: 'Atlas Outfitters',
    slug: 'atlas-outfitters',
    status: 'ACTIVE',
    defaultCurrency: 'USD',
    timezone: 'UTC',
    contactEmail: null,
    contactPhone: null,
  });
  vi.mocked(orgService.getOwnershipTransfer).mockResolvedValue(null);
  vi.mocked(memberService.listMembers).mockResolvedValue([]);
});

describe('billing page', () => {
  test('shows the plan, the trial, and usage against each limit', async () => {
    renderRoute('/settings/billing');
    const current = await screen.findByRole('heading', { name: 'Current plan' });
    const card = current.closest('section') ?? current.parentElement.parentElement;
    expect(await within(card).findByText('Trial')).toBeVisible();
    expect(card).toHaveTextContent('12 days left');
    expect(card).toHaveTextContent('read-only until a plan is chosen');

    const stores = screen.getByRole('meter', { name: 'Active stores' });
    expect(stores).toHaveAttribute('aria-valuenow', '3');
    expect(stores).toHaveAttribute('aria-valuemax', '3');
    expect(screen.getByText('3 of 3')).toHaveTextContent('(limit reached)');
    expect(screen.getByText('8 of 10')).toBeVisible();
    // Thousands are grouped as on the plan cards (the separator depends on the locale).
    expect(screen.getByText(/^120 of 1\D?000$/)).toBeVisible();
  });

  test('compares the plans and marks the current one', async () => {
    renderRoute('/settings/billing');
    const plans = await screen.findAllByRole('heading', { level: 3 });
    expect(plans.map((h) => h.textContent)).toEqual(['Starter', 'Growth', 'Scale']);
    const growth = plans[1].closest('li');
    expect(within(growth).getByText('Current plan')).toBeVisible();
    expect(growth).toHaveTextContent('CSV exports: included');
    expect(plans[0].closest('li')).toHaveTextContent('CSV exports: not included');
    expect(plans[0].closest('li')).toHaveTextContent(/29\.00/);
    expect(plans[0].closest('li')).toHaveTextContent('1 active store3 members');
  });

  test('is for owners only', async () => {
    vi.mocked(authService.getSession).mockResolvedValue(
      session({ role: 'MANAGER', permissions: ['org:read', 'member:read'] }),
    );
    renderRoute('/settings/billing');
    expect(await screen.findByText('You do not have access to this page')).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Billing' })).not.toBeInTheDocument();
    expect(billingService.getSubscription).not.toHaveBeenCalled();
  });
});

describe('subscription banner', () => {
  test('tells members of a read-only organization why and who can act', async () => {
    vi.mocked(authService.getSession).mockResolvedValue(
      session({
        role: 'ANALYST',
        permissions: ['org:read'],
        subscription: {
          status: 'EXPIRED',
          usable: false,
          planName: 'Growth',
          trialEndsAt: inDays(-2),
        },
      }),
    );
    renderRoute('/settings/profile');
    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent('This organization is read-only');
    expect(banner).toHaveTextContent('The trial has ended');
    expect(banner).toHaveTextContent('Ask the owner to choose a plan.');
  });

  test('gives owners a link to Billing, and warns them a week before the trial ends', async () => {
    vi.mocked(authService.getSession).mockResolvedValue(
      session({
        subscription: {
          status: 'TRIALING',
          usable: true,
          planName: 'Growth',
          trialEndsAt: inDays(3),
        },
      }),
    );
    renderRoute('/settings/profile');
    const banner = await screen.findByText(/Your Growth trial ends in 3 days/);
    expect(within(banner).getByRole('link', { name: 'Open Billing' })).toHaveAttribute(
      'href',
      '/settings/billing',
    );
  });

  test('stays out of the way earlier in the trial', async () => {
    renderRoute('/settings/profile');
    await screen.findByRole('heading', { level: 1, name: 'Your profile' });
    expect(screen.queryByText(/trial ends/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Billing' })).toHaveAttribute(
      'href',
      '/settings/billing',
    );
  });
});

describe('stores', () => {
  test('owners add a store with its currency and time zone', async () => {
    vi.mocked(orgService.createStore).mockResolvedValue({ ...STORE, id: 's2', name: 'Harbour' });
    renderRoute('/settings/organization');
    await userEvent.click(await screen.findByRole('button', { name: 'Add store' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a store' });
    await userEvent.type(within(dialog).getByLabelText('Store name'), 'Harbour');
    await userEvent.selectOptions(within(dialog).getByLabelText('Currency'), 'EUR');
    await userEvent.selectOptions(within(dialog).getByLabelText('Time zone'), 'Europe/Paris');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add store' }));

    await waitFor(() =>
      expect(orgService.createStore).toHaveBeenCalledWith({
        name: 'Harbour',
        currency: 'EUR',
        timezone: 'Europe/Paris',
      }),
    );
    expect(await screen.findByText('Harbour added.')).toBeVisible();
  });

  test('the plan limit is explained, with a way to the plans', async () => {
    vi.mocked(orgService.createStore).mockRejectedValue(
      apiError(402, {
        code: 'PLAN_LIMIT_REACHED',
        message:
          'The Starter plan includes 1 active store. Archive a store or change plan to add another.',
      }),
    );
    renderRoute('/settings/organization');
    await userEvent.click(await screen.findByRole('button', { name: 'Add store' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a store' });
    await userEvent.type(within(dialog).getByLabelText('Store name'), 'Harbour');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add store' }));

    expect(await within(dialog).findByText(/includes 1 active store/)).toBeVisible();
    expect(within(dialog).getByRole('link', { name: 'See plans' })).toHaveAttribute(
      'href',
      '/settings/billing',
    );
  });

  test('editing keeps the currency fixed and sends only what can change', async () => {
    vi.mocked(orgService.updateStore).mockResolvedValue({ ...STORE, name: 'Flagship' });
    renderRoute('/settings/organization');
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Main store' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit store' });
    expect(within(dialog).getByLabelText('Currency')).toBeDisabled();
    const name = within(dialog).getByLabelText('Store name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Flagship');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(orgService.updateStore).toHaveBeenCalledWith('s1', {
        name: 'Flagship',
        timezone: 'UTC',
      }),
    );
  });

  test('archiving asks first and reports a refusal', async () => {
    vi.mocked(orgService.archiveStore).mockRejectedValue(
      apiError(409, {
        code: 'LAST_ACTIVE_STORE',
        message: 'An organization needs at least one active store',
      }),
    );
    renderRoute('/settings/organization');
    await userEvent.click(await screen.findByRole('button', { name: 'Archive Main store' }));
    const confirm = await screen.findByRole('dialog', { name: 'Archive Main store?' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Archive store' }));
    expect(orgService.archiveStore).toHaveBeenCalledWith('s1');
    expect(
      await screen.findByText('An organization needs at least one active store'),
    ).toBeVisible();
  });

  test('other roles see the stores without the controls', async () => {
    vi.mocked(authService.getSession).mockResolvedValue(
      session({ role: 'MANAGER', permissions: ['org:read', 'member:read'] }),
    );
    renderRoute('/settings/organization');
    expect(await screen.findByText('Main store')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Add store' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Archive/ })).not.toBeInTheDocument();
  });
});
