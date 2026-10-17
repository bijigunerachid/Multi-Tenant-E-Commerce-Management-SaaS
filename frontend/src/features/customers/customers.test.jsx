import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { renderRoute, sessionFixture } from '../../tests/renderWithProviders.jsx';
import * as authService from '../../services/authService.js';
import * as customerService from '../../services/customerService.js';
import * as orderService from '../../services/orderService.js';

vi.mock('../../services/authService.js');
vi.mock('../../services/organizationService.js');
vi.mock('../../services/memberService.js');
vi.mock('../../services/customerService.js');
vi.mock('../../services/orderService.js');

const ORDER_PERMISSIONS = ['order:read', 'order:write', 'order:transition', 'order:cancel'];
const OWNER = [
  'org:read',
  'customer:read',
  'customer:write',
  'customer:export',
  ...ORDER_PERMISSIONS,
];
const ORDER_MANAGER = ['org:read', 'customer:read', 'customer:write', ...ORDER_PERMISSIONS];
const apiError = (status, error) =>
  Object.assign(new Error('Request failed'), { response: { status, data: { error } } });

const AMINA = {
  id: 'c1',
  name: 'Amina Haddad',
  email: 'amina@example.com',
  phone: '+212 600 000 000',
  notes: 'Prefers WhatsApp',
  archived: false,
  addresses: [
    {
      id: 'a1',
      label: 'Home',
      recipientName: null,
      line1: '12 Rue Atlas',
      line2: null,
      city: 'Casablanca',
      region: null,
      postalCode: '20000',
      country: 'MA',
      phone: null,
      isDefault: true,
    },
    {
      id: 'a2',
      label: 'Office',
      recipientName: null,
      line1: '1 Bd Zerktouni',
      line2: null,
      city: 'Casablanca',
      region: null,
      postalCode: null,
      country: 'MA',
      phone: null,
      isDefault: false,
    },
  ],
  createdAt: '2026-10-01T10:00:00Z',
  updatedAt: '2026-10-01T10:00:00Z',
  stats: {
    orderCount: 2,
    spent: [{ currency: 'MAD', total: '1250.00', averageOrder: '625.00' }],
    firstOrderAt: '2026-10-02T10:00:00Z',
    lastOrderAt: '2026-10-12T10:00:00Z',
    cancelledCount: 1,
  },
};

function signedInAs(role, permissions) {
  vi.mocked(authService.getSession).mockResolvedValue(sessionFixture({ role, permissions }));
}

beforeEach(() => {
  vi.mocked(customerService.listCustomers).mockResolvedValue({
    data: [
      {
        id: 'c1',
        name: 'Amina Haddad',
        email: 'amina@example.com',
        phone: '0611111111',
        archived: false,
        location: { city: 'Casablanca', country: 'MA' },
        createdAt: '2026-10-01T10:00:00Z',
        orderCount: 2,
        spent: [{ currency: 'MAD', total: '1250.00' }],
      },
      {
        id: 'c2',
        name: 'Walk-in buyer',
        email: null,
        phone: null,
        archived: false,
        location: null,
        createdAt: '2026-10-02T10:00:00Z',
        orderCount: 0,
        spent: [],
      },
    ],
    meta: { page: 1, pageSize: 25, total: 2 },
  });
  vi.mocked(customerService.getCustomer).mockResolvedValue(AMINA);
  vi.mocked(orderService.listOrders).mockResolvedValue({
    data: [
      {
        id: 'o2',
        number: 1002,
        status: 'PENDING',
        customer: { id: 'c1', name: 'Amina Haddad' },
        itemCount: 1,
        total: '450.00',
        currency: 'MAD',
        placedAt: '2026-10-12T10:00:00Z',
        createdAt: '2026-10-12T09:00:00Z',
      },
      {
        id: 'o1',
        number: 1001,
        status: 'DELIVERED',
        customer: { id: 'c1', name: 'Amina Haddad' },
        itemCount: 3,
        total: '800.00',
        currency: 'MAD',
        placedAt: '2026-10-02T10:00:00Z',
        createdAt: '2026-10-02T09:00:00Z',
      },
    ],
    meta: { page: 1, pageSize: 5, total: 7 },
  });
});

describe('purchase history', () => {
  test('the list shows how much each customer has spent', async () => {
    signedInAs('OWNER', OWNER);
    renderRoute('/customers');
    const amina = (await screen.findByRole('link', { name: 'Amina Haddad' })).closest('tr');
    expect(within(amina).getByText(/1,250\.00/)).toBeInTheDocument();
    const walkIn = screen.getByRole('link', { name: 'Walk-in buyer' }).closest('tr');
    expect(within(walkIn).getByText('0')).toBeInTheDocument();
  });

  test('the customer page shows spending, recent orders and a link to all of them', async () => {
    signedInAs('ORDER_MANAGER', ORDER_MANAGER);
    renderRoute('/customers/c1');

    expect(await screen.findByText('Total spent')).toBeInTheDocument();
    expect(screen.getByText('1 cancelled, not counted')).toBeInTheDocument();
    expect(screen.getByText(/625\.00/)).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: '#1002' })).toHaveAttribute(
      'href',
      '/orders/o2',
    );
    expect(screen.getByRole('link', { name: 'View all 7' })).toHaveAttribute(
      'href',
      '/orders?customerId=c1&customer=Amina%20Haddad',
    );
    expect(orderService.listOrders).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: 'c1', pageSize: 5 }),
    );
    expect(screen.getByRole('link', { name: 'New order' })).toHaveAttribute(
      'href',
      '/orders/new?customerId=c1',
    );
  });

  test('roles without order access see spending but no order list or new-order button', async () => {
    signedInAs('MANAGER', ['org:read', 'customer:read', 'customer:write']);
    renderRoute('/customers/c1');
    expect(await screen.findByText('Total spent')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'New order' })).not.toBeInTheDocument();
    expect(orderService.listOrders).not.toHaveBeenCalled();
  });
});

describe('customers list', () => {
  test('shows customers with their location and missing details made explicit', async () => {
    signedInAs('OWNER', OWNER);
    renderRoute('/customers');
    const amina = (await screen.findByRole('link', { name: 'Amina Haddad' })).closest('tr');
    expect(within(amina).getByText('Casablanca, Morocco')).toBeInTheDocument();
    const walkIn = screen.getByRole('link', { name: 'Walk-in buyer' }).closest('tr');
    expect(within(walkIn).getByText('No email')).toBeInTheDocument();
  });

  test('export reports a refusal (rate limit) instead of failing silently', async () => {
    signedInAs('OWNER', OWNER);
    vi.mocked(customerService.downloadCustomerExport).mockRejectedValue(
      apiError(429, {
        code: 'RATE_LIMITED',
        message: 'Too many attempts. Please wait and try again.',
      }),
    );
    renderRoute('/customers?status=all');
    await userEvent.click(await screen.findByRole('button', { name: 'Export CSV' }));
    expect(
      await screen.findByText('Too many attempts. Please wait and try again.'),
    ).toBeInTheDocument();
    expect(customerService.downloadCustomerExport).toHaveBeenCalledWith({
      status: 'all',
      search: undefined,
    });
  });

  test('order managers can add customers but cannot export', async () => {
    signedInAs('ORDER_MANAGER', ORDER_MANAGER);
    renderRoute('/customers');
    expect(await screen.findByRole('button', { name: 'New customer' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export CSV' })).not.toBeInTheDocument();
  });

  test('analysts cannot open customer data at all', async () => {
    signedInAs('ANALYST', ['org:read', 'product:read', 'report:read']);
    renderRoute('/customers');
    expect(await screen.findByText('You do not have access to this page')).toBeInTheDocument();
    expect(customerService.listCustomers).not.toHaveBeenCalled();
  });

  test('a duplicate email from the server is shown on the email field', async () => {
    signedInAs('OWNER', OWNER);
    vi.mocked(customerService.createCustomer).mockRejectedValue(
      apiError(409, {
        code: 'EMAIL_TAKEN',
        message: 'Another customer already uses this email',
        details: { fieldErrors: { email: 'Another customer already uses this email' } },
      }),
    );
    renderRoute('/customers');
    await userEvent.click(await screen.findByRole('button', { name: 'New customer' }));
    const dialog = await screen.findByRole('dialog', { name: 'New customer' });
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Amina');
    await userEvent.type(within(dialog).getByLabelText('Email'), 'amina@example.com');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add customer' }));
    expect(
      await within(dialog).findByText('Another customer already uses this email', {
        selector: 'p',
      }),
    ).toBeInTheDocument();
  });
});

describe('customer detail', () => {
  test('saving the profile sends blank optional fields as null', async () => {
    signedInAs('OWNER', OWNER);
    vi.mocked(customerService.updateCustomer).mockResolvedValue({ ...AMINA, phone: null });
    renderRoute('/customers/c1');

    const phone = await screen.findByLabelText('Phone');
    await userEvent.clear(phone);
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(customerService.updateCustomer).toHaveBeenCalled());
    expect(vi.mocked(customerService.updateCustomer).mock.calls[0]).toEqual([
      'c1',
      { name: 'Amina Haddad', email: 'amina@example.com', phone: null, notes: 'Prefers WhatsApp' },
    ]);
  });

  test('shows addresses with the default marked, and can switch the default', async () => {
    signedInAs('OWNER', OWNER);
    vi.mocked(customerService.updateAddress).mockResolvedValue({
      ...AMINA.addresses[1],
      isDefault: true,
    });
    renderRoute('/customers/c1');

    // Anchored on the street: "Home" is also the breadcrumb's first item.
    const home = (await screen.findByText('12 Rue Atlas', { exact: false })).closest('li');
    expect(within(home).getByText('Default')).toBeInTheDocument();
    expect(within(home).getByText('Morocco', { exact: false })).toBeInTheDocument();
    const office = screen.getByText('Office').closest('li');
    await userEvent.click(within(office).getByRole('button', { name: 'Make default' }));
    await waitFor(() =>
      expect(customerService.updateAddress).toHaveBeenCalledWith('c1', 'a2', { isDefault: true }),
    );
  });

  test('a new address needs a street, a city and a country', async () => {
    signedInAs('OWNER', OWNER);
    renderRoute('/customers/c1');
    await userEvent.click(await screen.findByRole('button', { name: 'Add address' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add address' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add address' }));
    expect(await within(dialog).findByText('Enter the street address')).toBeInTheDocument();
    expect(within(dialog).getByText('Enter a city')).toBeInTheDocument();
    expect(within(dialog).getByText('Choose a country', { selector: 'p' })).toBeInTheDocument();
    expect(customerService.addAddress).not.toHaveBeenCalled();
  });

  test('deleting a customer with orders explains the refusal', async () => {
    signedInAs('OWNER', OWNER);
    vi.mocked(customerService.deleteCustomer).mockRejectedValue(
      apiError(409, {
        code: 'CUSTOMER_HAS_ORDERS',
        message: 'This customer has orders and cannot be deleted. Archive it instead.',
      }),
    );
    renderRoute('/customers/c1');
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete Amina Haddad?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete customer' }));
    expect(
      await screen.findByText(
        'This customer has orders and cannot be deleted. Archive it instead.',
      ),
    ).toBeInTheDocument();
  });
});
