import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { renderRoute, sessionFixture } from '../../tests/renderWithProviders.jsx';
import * as authService from '../../services/authService.js';
import * as orgService from '../../services/organizationService.js';
import * as reportService from '../../services/reportService.js';
import * as orderService from '../../services/orderService.js';

vi.mock('../../services/authService.js');
vi.mock('../../services/organizationService.js');
vi.mock('../../services/memberService.js');
vi.mock('../../services/reportService.js');
vi.mock('../../services/orderService.js');

const OWNER = ['org:read', 'report:read', 'order:read', 'inventory:read', 'product:read'];
const ANALYST = ['org:read', 'report:read', 'inventory:read', 'product:read'];
const apiError = (status, error) =>
  Object.assign(new Error('Request failed'), { response: { status, data: { error } } });

const day = (period, revenue, orders) => ({ period, revenue, orders });
const DASHBOARD = {
  range: {
    from: '2026-09-01',
    to: '2026-09-30',
    timezone: 'Africa/Casablanca',
    bucket: 'day',
    previous: { from: '2026-08-02', to: '2026-08-31' },
  },
  currency: 'MAD',
  kpis: {
    revenue: { value: '260.00', previous: '100.00', changePercent: 160 },
    ordersPlaced: { value: 4, previous: 2, changePercent: 100 },
    averageOrderValue: { value: '86.67', previous: '100.00', changePercent: -13.3 },
    shippedOrders: 3,
    openOrders: 1,
    activeProducts: 3,
    lowStockVariants: 1,
    outOfStockVariants: 1,
  },
  otherCurrencyOrders: 0,
  revenueTrend: [
    day('2026-09-01', '50.00', 1),
    day('2026-09-02', '0.00', 0),
    day('2026-09-10', '200.00', 1),
  ],
  topProducts: [
    { productId: 'p1', productName: 'Linen shirt', units: 2, sales: '200.00' },
    { productId: 'p2', productName: 'Ceramic mug', units: 9, sales: '90.00' },
  ],
  inventoryAlerts: [
    {
      variantId: 'v3',
      productId: 'p3',
      productName: 'Olive board',
      variantName: 'Default',
      sku: 'BOARD-1',
      available: 0,
      threshold: 5,
      status: 'OUT',
    },
    {
      variantId: 'v1',
      productId: 'p1',
      productName: 'Linen shirt',
      variantName: 'Default',
      sku: 'SHIRT-1',
      available: 2,
      threshold: 5,
      status: 'LOW',
    },
  ],
  generatedAt: '2026-10-17T10:00:00Z',
  cached: false,
};

function signedInAs(role, permissions) {
  vi.mocked(authService.getSession).mockResolvedValue(sessionFixture({ role, permissions }));
}

beforeEach(() => {
  vi.mocked(reportService.getDashboard).mockResolvedValue(DASHBOARD);
  vi.mocked(orderService.listOrders).mockResolvedValue({
    data: [
      {
        id: 'o1',
        number: 1007,
        status: 'PENDING',
        customer: { id: 'c1', name: 'Amina Haddad' },
        itemCount: 1,
        total: '120.00',
        currency: 'MAD',
        placedAt: '2026-10-16T10:00:00Z',
        createdAt: '2026-10-16T09:00:00Z',
      },
    ],
    meta: { page: 1, pageSize: 5, total: 1 },
  });
  vi.mocked(orgService.listStores).mockResolvedValue([]);
});

describe('dashboard', () => {
  test('shows the KPIs with their change against the previous period', async () => {
    signedInAs('OWNER', OWNER);
    renderRoute('/');

    const revenue = (await screen.findByText('Revenue', { selector: 'dt' })).parentElement;
    expect(revenue).toHaveTextContent(/260\.00/);
    expect(revenue).toHaveTextContent('+160% vs previous 30 days');
    const average = screen.getByText('Average order value').parentElement;
    expect(average).toHaveTextContent('-13.3% vs previous 30 days');
    expect(screen.getByText('Open orders').closest('a')).toHaveAttribute('href', '/orders');
    expect(reportService.getDashboard).toHaveBeenCalledWith({});
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
  });

  test('lists inventory alerts with a status label, not colour alone, and recent orders', async () => {
    signedInAs('OWNER', OWNER);
    renderRoute('/');
    const board = (await screen.findByText('Olive board')).closest('li');
    expect(within(board).getByText('Out of stock')).toBeInTheDocument();
    expect(
      within(screen.getByText('Linen shirt', { selector: 'p' }).closest('li')).getByText(
        'Low stock',
      ),
    ).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: '#1007' })).toHaveAttribute(
      'href',
      '/orders/o1',
    );
  });

  test('the revenue chart has a table view with every period', async () => {
    signedInAs('OWNER', OWNER);
    renderRoute('/');
    expect(await screen.findByRole('img', { name: /Revenue by day, 3 days/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'View revenue as a table' }));
    const rows = within(screen.getAllByRole('table')[0]).getAllByRole('row');
    expect(rows).toHaveLength(4); // header + 3 periods
    expect(rows[3]).toHaveTextContent(/200\.00/);
  });

  test('range presets and a custom range are kept in the URL', async () => {
    signedInAs('OWNER', OWNER);
    const { router } = renderRoute('/');
    await userEvent.click(await screen.findByRole('button', { name: '7 days' }));
    await waitFor(() => expect(router.state.location.search).toBe('?days=7'));
    expect(reportService.getDashboard).toHaveBeenLastCalledWith({ days: 7 });
    expect(screen.getByRole('button', { name: '7 days' })).toHaveAttribute('aria-pressed', 'true');

    await userEvent.clear(screen.getByLabelText('From'));
    await userEvent.type(screen.getByLabelText('From'), '2026-09-30');
    await userEvent.clear(screen.getByLabelText('To'));
    await userEvent.type(screen.getByLabelText('To'), '2026-09-01');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.getByText('The start date must be before the end date.')).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText('From'));
    await userEvent.type(screen.getByLabelText('From'), '2026-08-01');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() =>
      expect(router.state.location.search).toBe('?from=2026-08-01&to=2026-09-01'),
    );
    expect(reportService.getDashboard).toHaveBeenLastCalledWith({
      from: '2026-08-01',
      to: '2026-09-01',
    });
  });

  test('no shipped orders shows an explanation instead of an empty chart', async () => {
    signedInAs('OWNER', OWNER);
    vi.mocked(reportService.getDashboard).mockResolvedValue({
      ...DASHBOARD,
      kpis: {
        ...DASHBOARD.kpis,
        shippedOrders: 0,
        revenue: { value: '0.00', previous: '0.00', changePercent: 0 },
        averageOrderValue: { value: null, previous: null, changePercent: null },
      },
      topProducts: [],
    });
    renderRoute('/');
    expect(await screen.findByText('No orders shipped in this period')).toBeInTheDocument();
    expect(screen.getByText('No sales yet in this period')).toBeInTheDocument();
    expect(
      screen.getAllByText('Nothing to compare with in the previous 30 days').length,
    ).toBeGreaterThan(0);
  });

  test('warns when some orders are in another currency', async () => {
    signedInAs('OWNER', OWNER);
    vi.mocked(reportService.getDashboard).mockResolvedValue({
      ...DASHBOARD,
      otherCurrencyOrders: 2,
    });
    renderRoute('/');
    expect(await screen.findByText(/2 shipped orders are in another currency/)).toBeInTheDocument();
  });

  test('shows an error with a retry instead of stale or invented numbers', async () => {
    signedInAs('OWNER', OWNER);
    vi.mocked(reportService.getDashboard).mockRejectedValueOnce(
      apiError(500, { code: 'INTERNAL_ERROR', message: 'Something went wrong' }),
    );
    renderRoute('/');
    expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
    expect(screen.queryByText('Revenue', { selector: 'dt' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Revenue', { selector: 'dt' })).toBeInTheDocument();
  });
});

describe('who sees what', () => {
  test('analysts see the dashboard but not individual orders', async () => {
    signedInAs('ANALYST', ANALYST);
    renderRoute('/');
    expect(await screen.findByRole('heading', { name: 'Dashboard', level: 1 })).toBeInTheDocument();
    expect(await screen.findByText('Active products')).toBeInTheDocument();
    expect(screen.queryByText('Recent orders')).not.toBeInTheDocument();
    expect(screen.getByText('Orders placed').closest('a')).toBeNull();
    expect(orderService.listOrders).not.toHaveBeenCalled();
  });

  test('roles without report access keep the organization overview', async () => {
    signedInAs('ORDER_MANAGER', ['org:read', 'order:read']);
    renderRoute('/');
    expect(
      await screen.findByRole('heading', { name: 'Atlas Outfitters', level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Overview' })).toBeInTheDocument();
    expect(reportService.getDashboard).not.toHaveBeenCalled();
  });
});
