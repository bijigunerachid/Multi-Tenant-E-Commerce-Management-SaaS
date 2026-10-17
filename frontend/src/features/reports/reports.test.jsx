import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { renderRoute, sessionFixture } from '../../tests/renderWithProviders.jsx';
import * as authService from '../../services/authService.js';
import * as orgService from '../../services/organizationService.js';
import * as reportService from '../../services/reportService.js';

vi.mock('../../services/authService.js');
vi.mock('../../services/organizationService.js');
vi.mock('../../services/memberService.js');
vi.mock('../../services/reportService.js');

const ANALYST = ['org:read', 'report:read', 'report:export', 'inventory:read', 'product:read'];
const apiError = (status, error) =>
  Object.assign(new Error('Request failed'), { response: { status, data: { error } } });

// Dates are formatted in the test machine's locale, as the page does.
const day = (d) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(`${d}T00:00:00`));
const range = { from: '2026-09-01', to: '2026-09-30', timezone: 'Africa/Casablanca' };
const salesRow = (periodStart, periodEnd, orders, netSales) => ({
  periodStart,
  periodEnd,
  orders,
  units: orders * 2,
  grossSales: netSales,
  discounts: '0.00',
  netSales,
  tax: '0.00',
  shipping: '0.00',
  total: netSales,
});
const SALES = {
  range: { ...range, groupBy: 'week' },
  currency: 'MAD',
  store: null,
  otherCurrencyOrders: 0,
  rows: [
    salesRow('2026-09-01', '2026-09-06', 1, '50.00'),
    salesRow('2026-09-07', '2026-09-13', 0, '0.00'),
  ],
  totals: {
    orders: 1,
    units: 2,
    grossSales: '50.00',
    discounts: '0.00',
    netSales: '50.00',
    tax: '0.00',
    shipping: '0.00',
    total: '50.00',
  },
};
const PRODUCTS = {
  range,
  currency: 'MAD',
  store: null,
  otherCurrencyOrders: 0,
  rows: [
    {
      variantId: 'v1',
      productId: 'p1',
      productName: 'Linen shirt',
      variantName: 'Size M',
      sku: 'SHIRT-M',
      units: 2,
      orders: 1,
      sales: '200.00',
      sharePercent: 69,
    },
  ],
  totals: { variants: 51, units: 11, sales: '290.00' },
  meta: { page: 1, pageSize: 50, total: 51 },
};
const STORES = {
  range,
  currency: 'MAD',
  store: null,
  otherCurrencyOrders: 1,
  rows: [
    {
      storeId: 's1',
      name: 'Main store',
      status: 'ACTIVE',
      orders: 3,
      netSales: '260.00',
      averageOrderValue: '86.67',
      otherCurrencyOrders: 1,
    },
    {
      storeId: 's2',
      name: 'Old kiosk',
      status: 'ARCHIVED',
      orders: 0,
      netSales: '0.00',
      averageOrderValue: null,
      otherCurrencyOrders: 0,
    },
  ],
  totals: { orders: 3, netSales: '260.00', averageOrderValue: '86.67' },
};

beforeEach(() => {
  vi.mocked(authService.getSession).mockResolvedValue(
    sessionFixture({ role: 'ANALYST', permissions: ANALYST }),
  );
  vi.mocked(orgService.listStores).mockResolvedValue([
    { id: 's1', name: 'Main store', status: 'ACTIVE' },
    { id: 's2', name: 'Old kiosk', status: 'ARCHIVED' },
  ]);
  vi.mocked(reportService.getReport).mockImplementation(async (report) => {
    return { sales: SALES, products: PRODUCTS, stores: STORES }[report];
  });
});

describe('reports', () => {
  test('the sales report shows every period and a total row', async () => {
    renderRoute('/reports?groupBy=week');
    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(4); // header, 2 periods, total
    expect(rows[1]).toHaveTextContent(`${day('2026-09-01')} – ${day('2026-09-06')}`);
    expect(rows[3]).toHaveTextContent(/^Total12/);
    expect(screen.getByRole('img', { name: /Revenue by week, 2 weeks/ })).toBeInTheDocument();
    expect(reportService.getReport).toHaveBeenCalledWith('sales', { groupBy: 'week' });
    expect(
      screen.getByText(`${day('2026-09-01')} – ${day('2026-09-30')} (Africa/Casablanca) · MAD`),
    ).toBeVisible();
  });

  test('grouping, store and range are kept in the URL and sent to the API', async () => {
    const { router } = renderRoute('/reports');
    await screen.findByRole('table');
    await userEvent.selectOptions(screen.getByLabelText('Group by'), 'month');
    await userEvent.selectOptions(screen.getByLabelText('Store'), 'Main store');
    await userEvent.click(screen.getByRole('button', { name: '90 days' }));
    await waitFor(() =>
      expect(router.state.location.search).toBe('?groupBy=month&storeId=s1&days=90'),
    );
    expect(reportService.getReport).toHaveBeenLastCalledWith('sales', {
      days: 90,
      storeId: 's1',
      groupBy: 'month',
    });
  });

  test('the products report pages through variants and links to each product', async () => {
    const { router } = renderRoute('/reports?report=products&storeId=s1');
    expect(await screen.findByRole('link', { name: 'Linen shirt' })).toHaveAttribute(
      'href',
      '/products/p1',
    );
    expect(screen.getByText('SHIRT-M · Size M')).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /All 51 variants/ })).toHaveTextContent('100%');
    expect(reportService.getReport).toHaveBeenCalledWith('products', {
      storeId: 's1',
      page: 1,
      pageSize: 50,
    });
    await userEvent.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(router.state.location.search).toContain('page=2'));
    expect(reportService.getReport).toHaveBeenLastCalledWith('products', {
      storeId: 's1',
      page: 2,
      pageSize: 50,
    });
  });

  test('switching report shows a loading state, not the previous report in the new layout', async () => {
    renderRoute('/reports');
    await screen.findByRole('table');
    let release;
    vi.mocked(reportService.getReport).mockImplementation(
      () => new Promise((resolve) => (release = () => resolve(PRODUCTS))),
    );
    const tabs = screen.getByRole('navigation', { name: 'Reports' });
    await userEvent.click(within(tabs).getByRole('link', { name: 'Products' }));
    expect(await screen.findByLabelText('Loading report')).toBeInTheDocument();
    release();
    expect(await screen.findByRole('link', { name: 'Linen shirt' })).toBeInTheDocument();
  });

  test('the stores report has no store filter and flags archived stores', async () => {
    renderRoute('/reports?report=stores&storeId=s1');
    const kiosk = await screen.findByRole('row', { name: /Old kiosk/ });
    expect(within(kiosk).getByText('Archived')).toBeInTheDocument();
    expect(within(kiosk).getByText('—')).toBeInTheDocument(); // no average without orders
    expect(screen.queryByLabelText('Store')).not.toBeInTheDocument();
    expect(reportService.getReport).toHaveBeenCalledWith('stores', {});
    expect(
      screen.getByText(/1 shipped order is in another currency and not included/),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Stores' })).toHaveAttribute('aria-current', 'page');
  });

  test('export downloads the report on screen and shows refusals', async () => {
    vi.mocked(reportService.downloadReport)
      .mockResolvedValueOnce('sales-2026-09-01-to-2026-09-30.csv')
      .mockRejectedValueOnce(
        apiError(429, { code: 'RATE_LIMITED', message: 'Too many attempts. Please wait.' }),
      );
    renderRoute('/reports?groupBy=week&storeId=s2&page=3');
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(
      await screen.findByText('Downloaded sales-2026-09-01-to-2026-09-30.csv.'),
    ).toBeInTheDocument();
    // The export takes the report's filters, not the page number.
    expect(reportService.downloadReport).toHaveBeenCalledWith('sales', {
      storeId: 's2',
      groupBy: 'week',
    });
    await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(await screen.findByText('Too many attempts. Please wait.')).toBeInTheDocument();
  });

  test('an empty period explains itself instead of drawing an empty chart', async () => {
    vi.mocked(reportService.getReport).mockResolvedValue({
      ...SALES,
      rows: [salesRow('2026-09-01', '2026-09-06', 0, '0.00')],
      totals: { ...SALES.totals, orders: 0, units: 0, netSales: '0.00' },
    });
    renderRoute('/reports');
    expect(await screen.findByText('No orders shipped in this period')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  test('errors are shown with a retry', async () => {
    vi.mocked(reportService.getReport).mockRejectedValueOnce(
      apiError(404, { code: 'NOT_FOUND', message: 'Store not found' }),
    );
    renderRoute('/reports?storeId=gone');
    expect(await screen.findByText('Store not found')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('table')).toBeInTheDocument();
  });
});

describe('who sees reports', () => {
  test('analysts have the Reports entry in the navigation', async () => {
    renderRoute('/reports');
    expect(await screen.findByRole('link', { name: 'Reports' })).toHaveAttribute(
      'href',
      '/reports',
    );
  });

  test('roles without report access get no entry and no data', async () => {
    vi.mocked(authService.getSession).mockResolvedValue(
      sessionFixture({ role: 'ORDER_MANAGER', permissions: ['org:read', 'order:read'] }),
    );
    renderRoute('/reports');
    expect(await screen.findByText('You do not have access to this page')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Reports' })).not.toBeInTheDocument();
    expect(reportService.getReport).not.toHaveBeenCalled();
  });
});
