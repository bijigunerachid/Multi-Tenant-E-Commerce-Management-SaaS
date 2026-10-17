import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { renderRoute, sessionFixture } from '../../tests/renderWithProviders.jsx';
import * as authService from '../../services/authService.js';
import * as orgService from '../../services/organizationService.js';
import * as orderService from '../../services/orderService.js';

vi.mock('../../services/authService.js');
vi.mock('../../services/organizationService.js');
vi.mock('../../services/memberService.js');
vi.mock('../../services/customerService.js');
vi.mock('../../services/orderService.js');

const ORDER_ROLE = [
  'org:read',
  'customer:read',
  'order:read',
  'order:write',
  'order:transition',
  'order:cancel',
];
const apiError = (status, error) =>
  Object.assign(new Error('Request failed'), { response: { status, data: { error } } });

const MUG = {
  variantId: 'v-mug',
  sku: 'MUG-1',
  productName: 'Ceramic mug',
  variantName: 'Default',
  price: '9.50',
  currency: 'MAD',
  available: 4,
};
const orderFixture = (overrides = {}) => ({
  id: 'o1',
  number: 1001,
  status: 'PENDING',
  allowedActions: ['confirm', 'cancel'],
  store: { id: 's1', name: 'Casablanca flagship' },
  customer: { id: 'c1', name: 'Amina Haddad', email: 'amina@example.com' },
  shippingAddress: {
    recipientName: 'Amina Haddad',
    line1: '12 Rue Atlas',
    line2: null,
    city: 'Casablanca',
    region: null,
    postalCode: '20000',
    country: 'MA',
    phone: null,
  },
  currency: 'MAD',
  subtotal: '19.00',
  discountTotal: '0.00',
  taxRate: '0',
  taxTotal: '0.00',
  shippingTotal: '0.00',
  total: '19.00',
  notes: null,
  cancelReason: null,
  items: [
    {
      id: 'i1',
      variantId: 'v-mug',
      productName: 'Ceramic mug',
      variantName: 'Default',
      sku: 'MUG-1',
      unitPrice: '9.50',
      quantity: 2,
      lineTotal: '19.00',
      reservation: 'ACTIVE',
    },
  ],
  history: [
    {
      fromStatus: 'DRAFT',
      toStatus: 'PENDING',
      note: null,
      actor: { id: 'u1', name: 'Omar Idrissi' },
      createdAt: '2026-10-15T10:00:00Z',
    },
  ],
  placedAt: '2026-10-15T10:00:00Z',
  createdAt: '2026-10-15T09:00:00Z',
  ...overrides,
});

function signedInAs(role, permissions) {
  vi.mocked(authService.getSession).mockResolvedValue(sessionFixture({ role, permissions }));
}

beforeEach(() => {
  vi.mocked(orgService.listStores).mockResolvedValue([
    { id: 's1', name: 'Casablanca flagship', status: 'ACTIVE' },
  ]);
  vi.mocked(orderService.listOrders).mockResolvedValue({
    data: [
      {
        id: 'o1',
        number: 1001,
        status: 'PENDING',
        customer: { id: 'c1', name: 'Amina Haddad' },
        itemCount: 2,
        total: '19.00',
        currency: 'MAD',
        placedAt: '2026-10-15T10:00:00Z',
        createdAt: '2026-10-15T09:00:00Z',
      },
      {
        id: 'o2',
        number: null,
        status: 'DRAFT',
        customer: null,
        itemCount: 1,
        total: '9.50',
        currency: 'MAD',
        placedAt: null,
        createdAt: '2026-10-15T11:00:00Z',
      },
    ],
    meta: { page: 1, pageSize: 25, total: 2 },
  });
  vi.mocked(orderService.searchSellableVariants).mockResolvedValue([MUG]);
});

describe('orders list', () => {
  test('shows numbered orders and drafts, and filters by status through the URL', async () => {
    signedInAs('ORDER_MANAGER', ORDER_ROLE);
    const { router } = renderRoute('/orders');
    const placed = (await screen.findByRole('link', { name: '#1001' })).closest('tr');
    expect(within(placed).getByText('Pending')).toBeInTheDocument();
    expect(
      within(screen.getByRole('link', { name: 'Draft' }).closest('tr')).getByText('No customer'),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Shipped' }));
    await waitFor(() => expect(router.state.location.search).toBe('?status=SHIPPED'));
    expect(orderService.listOrders).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'SHIPPED' }),
    );
  });

  test('analysts cannot open orders', async () => {
    signedInAs('ANALYST', ['org:read', 'report:read']);
    renderRoute('/orders');
    expect(await screen.findByText('You do not have access to this page')).toBeInTheDocument();
    expect(orderService.listOrders).not.toHaveBeenCalled();
  });
});

describe('new order form', () => {
  async function addMug() {
    await userEvent.type(await screen.findByLabelText('Add a product'), 'mug');
    await userEvent.click(await screen.findByRole('button', { name: /Ceramic mug/ }));
  }

  test('sends only ids and quantities (never prices), and converts the tax percentage', async () => {
    signedInAs('ORDER_MANAGER', ORDER_ROLE);
    vi.mocked(orderService.createOrder).mockResolvedValue(
      orderFixture({ status: 'DRAFT', number: null, allowedActions: ['place'] }),
    );
    renderRoute('/orders/new');

    await addMug();
    await addMug(); // picking the same product again increases the quantity
    expect(screen.getByLabelText('Quantity of MUG-1')).toHaveValue('2');
    await userEvent.type(screen.getByLabelText('Tax rate (%)'), '20');
    expect(screen.getByText('Total', { selector: 'dt' }).nextSibling).toHaveTextContent('22.80');

    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(orderService.createOrder).toHaveBeenCalled());
    expect(vi.mocked(orderService.createOrder).mock.calls[0][0]).toEqual({
      storeId: undefined,
      customerId: null,
      shippingAddressId: null,
      shippingAddress: null,
      items: [{ variantId: 'v-mug', quantity: 2 }],
      discountTotal: '0',
      shippingTotal: '0',
      taxRate: '0.2',
      notes: null,
    });
  });

  test('warns about low stock and validates quantities before sending', async () => {
    signedInAs('ORDER_MANAGER', ORDER_ROLE);
    renderRoute('/orders/new');
    await addMug();
    const qty = screen.getByLabelText('Quantity of MUG-1');
    await userEvent.clear(qty);
    await userEvent.type(qty, '6');
    expect(screen.getByText('Only 4 available')).toBeInTheDocument();
    await userEvent.clear(qty);
    await userEvent.type(qty, '0');
    await userEvent.click(screen.getByRole('button', { name: 'Save and place order' }));
    expect(await screen.findByText('Enter a whole number of at least 1')).toBeInTheDocument();
    expect(orderService.createOrder).not.toHaveBeenCalled();
  });

  test('if placing fails for stock, the draft is kept and the retry updates it instead of creating another', async () => {
    signedInAs('ORDER_MANAGER', ORDER_ROLE);
    vi.mocked(orderService.createOrder).mockResolvedValue(
      orderFixture({ id: 'd1', status: 'DRAFT', number: null }),
    );
    vi.mocked(orderService.transitionOrder).mockRejectedValueOnce(
      apiError(409, {
        code: 'INSUFFICIENT_STOCK',
        message: 'Not enough stock for MUG-1: 4 available, 5 ordered',
        details: { fieldErrors: { 'items.0.quantity': 'Only 4 available' } },
      }),
    );
    renderRoute('/orders/new');
    await addMug();
    const qty = screen.getByLabelText('Quantity of MUG-1');
    await userEvent.clear(qty);
    await userEvent.type(qty, '5');
    await userEvent.click(screen.getByRole('button', { name: 'Save and place order' }));

    expect(
      await screen.findByText('Not enough stock for MUG-1: 4 available, 5 ordered'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Quantity of MUG-1')).toHaveAttribute('aria-invalid', 'true');

    vi.mocked(orderService.updateOrder).mockResolvedValue(
      orderFixture({ id: 'd1', status: 'DRAFT', number: null }),
    );
    vi.mocked(orderService.transitionOrder).mockResolvedValue(orderFixture({ id: 'd1' }));
    await userEvent.clear(qty);
    await userEvent.type(qty, '4');
    await userEvent.click(screen.getByRole('button', { name: 'Save and place order' }));
    await waitFor(() =>
      expect(orderService.updateOrder).toHaveBeenCalledWith(
        'd1',
        expect.objectContaining({ items: [{ variantId: 'v-mug', quantity: 4 }] }),
      ),
    );
    expect(orderService.createOrder).toHaveBeenCalledTimes(1);
  });
});

describe('delivery address', () => {
  test('picking a customer preselects their default address', async () => {
    signedInAs('ORDER_MANAGER', ORDER_ROLE);
    const customerService = await import('../../services/customerService.js');
    vi.mocked(customerService.listCustomers).mockResolvedValue({
      data: [{ id: 'c1', name: 'Amina Haddad', email: 'amina@example.com', phone: null }],
      meta: { page: 1, pageSize: 6, total: 1 },
    });
    vi.mocked(customerService.getCustomer).mockResolvedValue({
      id: 'c1',
      name: 'Amina Haddad',
      email: 'amina@example.com',
      addresses: [
        {
          id: 'a-work',
          label: 'Work',
          line1: '1 Bd Zerktouni',
          city: 'Casablanca',
          country: 'MA',
          isDefault: false,
        },
        {
          id: 'a-home',
          label: 'Home',
          line1: '12 Rue Atlas',
          city: 'Rabat',
          country: 'MA',
          isDefault: true,
        },
      ],
    });
    renderRoute('/orders/new');
    await userEvent.type(await screen.findByLabelText('Find a customer'), 'amina');
    await userEvent.click(await screen.findByRole('button', { name: /Amina Haddad/ }));
    await waitFor(() => expect(screen.getByLabelText('Ship to')).toHaveValue('a-home'));
  });

  test('editing a draft keeps its existing address unless the user changes it', async () => {
    signedInAs('ORDER_MANAGER', ORDER_ROLE);
    const draftOrder = orderFixture({
      id: 'd1',
      number: null,
      status: 'DRAFT',
      allowedActions: ['place'],
      customer: null,
    });
    vi.mocked(orderService.getOrder).mockResolvedValue(draftOrder);
    vi.mocked(orderService.updateOrder).mockResolvedValue(draftOrder);
    renderRoute('/orders/d1/edit');

    expect(await screen.findByLabelText('Ship to')).toHaveDisplayValue(
      'Current: 12 Rue Atlas, Casablanca',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(orderService.updateOrder).toHaveBeenCalled());
    expect(vi.mocked(orderService.updateOrder).mock.calls[0][1]).toMatchObject({
      shippingAddressId: null,
      shippingAddress: draftOrder.shippingAddress,
    });
  });
});

describe('order detail', () => {
  test('offers the next lifecycle step and cancellation with a required reason', async () => {
    signedInAs('ORDER_MANAGER', ORDER_ROLE);
    vi.mocked(orderService.getOrder).mockResolvedValue(orderFixture());
    vi.mocked(orderService.transitionOrder).mockResolvedValue(
      orderFixture({ status: 'CONFIRMED', allowedActions: ['start', 'cancel'] }),
    );
    renderRoute('/orders/o1');

    expect(
      await screen.findByRole('heading', { name: 'Order #1001', level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByText('Reserved')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark as shipped' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Confirm order' }));
    await waitFor(() => expect(orderService.transitionOrder).toHaveBeenCalledWith('o1', 'confirm'));
    expect(await screen.findByRole('button', { name: 'Start processing' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Cancel order' }));
    const dialog = await screen.findByRole('dialog', { name: 'Cancel Order #1001?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel order' }));
    expect(await within(dialog).findByText('Give a reason for cancelling')).toBeInTheDocument();
    expect(orderService.cancelOrder).not.toHaveBeenCalled();
  });

  test('a delivered order offers no actions', async () => {
    signedInAs('ORDER_MANAGER', ORDER_ROLE);
    vi.mocked(orderService.getOrder).mockResolvedValue(
      orderFixture({ status: 'DELIVERED', allowedActions: [] }),
    );
    renderRoute('/orders/o1');
    expect(await screen.findByText('Delivered', { selector: 'span' })).toBeInTheDocument();
    for (const name of ['Cancel order', 'Confirm order', 'Mark as delivered', 'Edit']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
  });

  test('drafts can be edited or deleted and show that nothing is reserved yet', async () => {
    signedInAs('ORDER_MANAGER', ORDER_ROLE);
    vi.mocked(orderService.getOrder).mockResolvedValue(
      orderFixture({
        number: null,
        status: 'DRAFT',
        allowedActions: ['place'],
        history: [],
        placedAt: null,
        items: [{ ...orderFixture().items[0], reservation: null }],
      }),
    );
    renderRoute('/orders/o1');
    expect(
      await screen.findByRole('heading', { name: 'Draft order', level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Edit' })).toHaveAttribute('href', '/orders/o1/edit');
    expect(screen.getByRole('button', { name: 'Delete draft' })).toBeInTheDocument();
    expect(screen.getByText('Not reserved')).toBeInTheDocument();
    expect(screen.getByText('This draft has not been placed yet.')).toBeInTheDocument();
  });
});

describe('orders of one customer', () => {
  test('"New order" from a customer starts the form with that customer and their default address', async () => {
    signedInAs('ORDER_MANAGER', ORDER_ROLE);
    const customerService = await import('../../services/customerService.js');
    vi.mocked(customerService.getCustomer).mockResolvedValue({
      id: 'c1',
      name: 'Amina Haddad',
      email: 'amina@example.com',
      archived: false,
      addresses: [
        {
          id: 'a-home',
          label: 'Home',
          line1: '12 Rue Atlas',
          city: 'Rabat',
          country: 'MA',
          isDefault: true,
        },
      ],
    });
    renderRoute('/orders/new?customerId=c1');

    expect(await screen.findByText('amina@example.com')).toBeInTheDocument();
    expect(screen.queryByLabelText('Find a customer')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Ship to')).toHaveValue('a-home'));
  });

  test('the orders list can be filtered by customer and the filter removed', async () => {
    signedInAs('ORDER_MANAGER', ORDER_ROLE);
    const { router } = renderRoute('/orders?customerId=c1&customer=Amina%20Haddad');

    expect(await screen.findByText('Customer: Amina Haddad')).toBeInTheDocument();
    expect(orderService.listOrders).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: 'c1' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Show orders of all customers' }));
    await waitFor(() => expect(router.state.location.search).toBe(''));
    expect(orderService.listOrders).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ customerId: 'c1' }),
    );
  });
});
