import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { renderRoute, sessionFixture } from '../../tests/renderWithProviders.jsx';
import * as authService from '../../services/authService.js';
import * as notificationService from '../../services/notificationService.js';
import { describeNotification } from './describe.js';

vi.mock('../../services/authService.js');
vi.mock('../../services/organizationService.js');
vi.mock('../../services/inventoryService.js');
vi.mock('../../services/orderService.js');

const OWNER = ['org:read', 'order:read', 'order:transition', 'inventory:read', 'inventory:adjust'];
const minutesAgo = (m) => new Date(Date.now() - m * 60_000).toISOString();

const ORDER = {
  id: 'n-order',
  type: 'order.placed',
  readAt: null,
  createdAt: minutesAgo(2),
  data: {
    orderId: 'order-1',
    number: 1042,
    total: '300.00',
    currency: 'USD',
    itemCount: 3,
    storeName: 'Main store',
  },
};
const STOCK = {
  id: 'n-stock',
  type: 'inventory.low_stock',
  readAt: minutesAgo(30),
  createdAt: minutesAgo(90),
  data: {
    status: 'LOW',
    available: 4,
    threshold: 5,
    sku: 'SHIRT-M',
    productName: 'Linen shirt',
    variantName: 'M',
    storeId: 'store-1',
    storeName: 'Main store',
  },
};
const page = (data, meta = {}) => ({
  data,
  meta: { page: 1, pageSize: 20, total: data.length, unreadCount: 1, ...meta },
});

beforeEach(() => {
  vi.mocked(authService.getSession).mockResolvedValue(
    sessionFixture({ role: 'OWNER', permissions: OWNER }),
  );
  vi.mocked(notificationService.getUnreadCount).mockResolvedValue(1);
  vi.mocked(notificationService.listNotifications).mockResolvedValue(page([ORDER, STOCK]));
  vi.mocked(notificationService.markNotificationRead).mockResolvedValue({
    ...ORDER,
    readAt: new Date().toISOString(),
  });
  vi.mocked(notificationService.markAllNotificationsRead).mockResolvedValue({ updated: 1 });
  vi.mocked(notificationService.getNotificationPreferences).mockResolvedValue([
    { type: 'order.placed', email: false },
    { type: 'inventory.low_stock', email: true },
  ]);
});

const bell = () => screen.findByRole('button', { name: /^Notifications/ });

describe('notification bell', () => {
  test('shows the unread count and lists the latest notifications in words', async () => {
    renderRoute('/settings/profile');
    expect(await screen.findByRole('button', { name: 'Notifications, 1 unread' })).toBeVisible();

    await userEvent.click(await bell());
    const panel = await screen.findByRole('dialog', { name: 'Notifications' });
    const order = await within(panel).findByRole('link', { name: /New order #1042/ });
    expect(order).toHaveTextContent('(unread)');
    // The currency symbol depends on the locale ("$" or "US$").
    expect(order).toHaveTextContent(/3 items, \S*300\.00 · Main store/);
    expect(order).toHaveTextContent('2 minutes ago');
    expect(order).toHaveAttribute('href', '/orders/order-1');

    const stock = within(panel).getByRole('link', { name: /Low stock: SHIRT-M/ });
    expect(stock).not.toHaveTextContent('(unread)');
    expect(stock).toHaveAttribute('href', '/inventory?storeId=store-1&search=SHIRT-M');
    expect(notificationService.listNotifications).toHaveBeenCalledWith({ pageSize: 6 });
  });

  test('opening an unread notification marks it read and follows its link', async () => {
    const { router } = renderRoute('/settings/profile');
    await userEvent.click(await bell());
    await userEvent.click(await screen.findByRole('link', { name: /New order #1042/ }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/orders/order-1'));
    expect(notificationService.markNotificationRead).toHaveBeenCalledWith('n-order');
    expect(screen.queryByRole('dialog', { name: 'Notifications' })).not.toBeInTheDocument();
  });

  test('marks everything read and refreshes the count', async () => {
    renderRoute('/settings/profile');
    await userEvent.click(await bell());
    vi.mocked(notificationService.getUnreadCount).mockResolvedValue(0);
    await userEvent.click(await screen.findByRole('button', { name: 'Mark all as read' }));

    expect(notificationService.markAllNotificationsRead).toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: 'Notifications' })).toBeVisible();
  });

  test('says when there is nothing new and caps a large count', async () => {
    vi.mocked(notificationService.getUnreadCount).mockResolvedValue(250);
    vi.mocked(notificationService.listNotifications).mockResolvedValue(page([]));
    renderRoute('/settings/profile');
    const button = await screen.findByRole('button', { name: 'Notifications, 250 unread' });
    expect(button).toHaveTextContent('99+');
    await userEvent.click(button);
    expect(await screen.findByText(/You are all caught up/)).toBeVisible();
  });
});

describe('notifications page', () => {
  test('filters unread notifications through the URL', async () => {
    const { router } = renderRoute('/notifications');
    expect(await screen.findByRole('heading', { level: 1, name: 'Notifications' })).toBeVisible();
    await screen.findAllByRole('link', { name: /New order #1042/ });

    await userEvent.click(screen.getByRole('button', { name: 'Unread (1)' }));
    await waitFor(() => expect(router.state.location.search).toBe('?filter=unread'));
    expect(notificationService.listNotifications).toHaveBeenLastCalledWith({
      page: 1,
      pageSize: 20,
      unread: 'true',
    });
  });

  test('turns an email copy on and off', async () => {
    vi.mocked(notificationService.updateNotificationPreferences).mockResolvedValue([
      { type: 'order.placed', email: true },
      { type: 'inventory.low_stock', email: true },
    ]);
    renderRoute('/notifications');
    const orders = await screen.findByRole('checkbox', { name: /New orders/ });
    expect(orders).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Low stock/ })).toBeChecked();

    await userEvent.click(orders);
    expect(notificationService.updateNotificationPreferences).toHaveBeenCalledWith({
      'order.placed': true,
    });
    await waitFor(() => expect(orders).toBeChecked());
    expect(await screen.findByText('Email settings saved.')).toBeVisible();
  });

  test('a setting that fails to save goes back and says why', async () => {
    let fail;
    vi.mocked(notificationService.updateNotificationPreferences).mockReturnValue(
      new Promise((_resolve, reject) => {
        fail = () => reject(new Error('Network Error'));
      }),
    );
    renderRoute('/notifications');
    const orders = await screen.findByRole('checkbox', { name: /New orders/ });
    await userEvent.click(orders);
    // Checked straight away, while the save is in flight.
    expect(orders).toBeChecked();
    fail();
    await waitFor(() => expect(orders).not.toBeChecked());
    expect(await screen.findByRole('alert')).toBeVisible();
  });

  test('roles that receive nothing are told so', async () => {
    vi.mocked(authService.getSession).mockResolvedValue(
      sessionFixture({ role: 'ANALYST', permissions: ['org:read', 'report:read'] }),
    );
    vi.mocked(notificationService.listNotifications).mockResolvedValue(
      page([], { unreadCount: 0 }),
    );
    vi.mocked(notificationService.getNotificationPreferences).mockResolvedValue([]);
    renderRoute('/notifications');
    expect(await screen.findByText('No notifications yet')).toBeVisible();
    expect(
      await screen.findByText('Your role does not receive notifications in this organization.'),
    ).toBeVisible();
  });
});

test('out-of-stock alerts read differently from low-stock ones', () => {
  const out = describeNotification({
    ...STOCK,
    data: { ...STOCK.data, status: 'OUT', available: 0 },
  });
  expect(out).toMatchObject({
    title: 'Out of stock: SHIRT-M',
    body: 'Linen shirt (M) is out of stock at Main store.',
    tone: 'danger',
  });
  expect(describeNotification(STOCK).body).toBe(
    'Linen shirt (M): 4 left at Main store (alert at 5).',
  );
});
