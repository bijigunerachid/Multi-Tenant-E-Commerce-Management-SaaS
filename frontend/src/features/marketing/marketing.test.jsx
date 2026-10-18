import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { renderRoute, sessionFixture } from '../../tests/renderWithProviders.jsx';
import * as authService from '../../services/authService.js';
import * as planService from '../../services/planService.js';

vi.mock('../../services/authService.js');
vi.mock('../../services/planService.js');
vi.mock('../../services/organizationService.js');

const plan = (code, name, priceMonthly, stores, csvExport) => ({
  code,
  name,
  priceMonthly,
  currency: 'USD',
  limits: { stores, members: stores * 3, products: stores * 100 },
  features: { csvExport },
});
const PLANS = [
  plan('starter', 'Starter', '29.00', 1, false),
  plan('growth', 'Growth', '79.00', 3, true),
  plan('scale', 'Scale', '199.00', 10, true),
];

beforeEach(() => {
  vi.mocked(authService.getSession).mockResolvedValue(null);
  vi.mocked(planService.getPublicPlans).mockResolvedValue(PLANS);
});

describe('homepage', () => {
  test('visitors at the home address get the public homepage, not the sign-in page', async () => {
    const { router } = renderRoute('/');
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Know what’s on every shelf, in every store.',
      }),
    ).toBeVisible();
    expect(router.state.location.pathname).toBe('/');
    expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument();
    expect(document.title).toBe('Vendora');

    const main = screen.getByRole('main');
    expect(within(main).getAllByRole('link', { name: 'Start your free trial' })[0]).toHaveAttribute(
      'href',
      '/register',
    );
    const header = screen.getByRole('banner');
    expect(within(header).getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
    // The hero is labelled as an example, not passed off as customer data.
    expect(screen.getByRole('figure', { name: /^Example:/ })).toBeVisible();
  });

  test('prices and plan answers come from the plans the API returns', async () => {
    renderRoute('/');
    const pricing = (
      await screen.findByRole('heading', { name: 'Pay for the shop you run' })
    ).closest('section');
    // Plans arrive from the API after the page renders.
    const growth = (await within(pricing).findByRole('heading', { name: 'Growth' })).closest('li');
    expect(growth).toHaveTextContent(/79\.00/);
    expect(growth).toHaveTextContent('3 stores');
    expect(
      within(pricing).getByRole('heading', { name: 'Starter' }).closest('li'),
    ).toHaveTextContent('CSV exports: not included');

    await userEvent.click(screen.getByText('How many stores can I run?'));
    expect(screen.getByText(/Starter 1, Growth 3 and Scale 10/)).toBeVisible();
    await userEvent.click(screen.getByText('Can I get my data out?'));
    expect(screen.getByText(/on the Growth and Scale plans/)).toBeVisible();
  });

  test('the role table matches what each role can do', async () => {
    renderRoute('/');
    const table = await screen.findByRole('table', { name: 'What each role can do' });
    const row = (task) => within(table).getByRole('row', { name: new RegExp(`^${task}`) });
    expect(within(row('Read reports')).getAllByLabelText('Yes')).toHaveLength(3);
    expect(within(row('Invite and manage the team')).getAllByLabelText('Yes')).toHaveLength(1);
    expect(within(row('See products and stock')).getAllByLabelText('Yes')).toHaveLength(5);
  });

  test('members at the home address get the app, as before', async () => {
    vi.mocked(authService.getSession).mockResolvedValue(sessionFixture());
    renderRoute('/');
    expect(await screen.findByRole('navigation', { name: 'Main' })).toBeVisible();
    expect(planService.getPublicPlans).not.toHaveBeenCalled();
  });

  test('other private pages still send visitors to sign in', async () => {
    const { router } = renderRoute('/orders');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeVisible();
    expect(router.state.location.search).toBe('?next=%2Forders');
  });
});

describe('pricing page', () => {
  test('lists every plan with its limits, and marks the trial plan', async () => {
    renderRoute('/pricing');
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Pay for the stores and team you have.',
      }),
    ).toBeVisible();
    await waitFor(() => expect(document.title).toBe('Pricing · Vendora'));
    const growth = (await screen.findByRole('heading', { level: 2, name: 'Growth' })).closest('li');
    expect(within(growth).getByText('The trial plan')).toBeVisible();
    expect(growth).toHaveTextContent('9 team members');
    expect(screen.getAllByRole('link', { name: 'Start your free trial' })).toHaveLength(3);
  });

  test('says so and offers a retry when prices cannot be loaded', async () => {
    vi.mocked(planService.getPublicPlans).mockRejectedValueOnce(new Error('Network Error'));
    renderRoute('/pricing');
    expect(await screen.findByText(/Prices could not be loaded/)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Scale' })).toBeVisible();
  });

  test('signed-in people are offered a way back into the app', async () => {
    vi.mocked(authService.getSession).mockResolvedValue(sessionFixture());
    renderRoute('/pricing');
    const header = await screen.findByRole('banner');
    expect(await within(header).findByRole('link', { name: 'Open Vendora' })).toHaveAttribute(
      'href',
      '/',
    );
    expect(within(header).queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument();
  });
});
