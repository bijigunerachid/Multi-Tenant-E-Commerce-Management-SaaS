import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { renderRoute, sessionFixture } from '../../tests/renderWithProviders.jsx';
import * as authService from '../../services/authService.js';
import * as orgService from '../../services/organizationService.js';
import * as inventoryService from '../../services/inventoryService.js';

vi.mock('../../services/authService.js');
vi.mock('../../services/organizationService.js');
vi.mock('../../services/memberService.js');
vi.mock('../../services/catalogService.js');
vi.mock('../../services/inventoryService.js');

const STORE = {
  id: 's1',
  name: 'Casablanca flagship',
  slug: 'main',
  currency: 'MAD',
  timezone: 'UTC',
  status: 'ACTIVE',
};
const row = (overrides = {}) => ({
  variantId: 'v1',
  productId: 'p1',
  productName: 'Linen shirt',
  productStatus: 'ACTIVE',
  variantName: 'M',
  sku: 'SHIRT-M',
  onHand: 8,
  reserved: 5,
  available: 3,
  lowStockThreshold: 5,
  status: 'LOW',
  unitCost: '120.00',
  stockValue: '960.00',
  currency: 'MAD',
  updatedAt: '2026-10-15T10:00:00Z',
  ...overrides,
});
const SUMMARY = {
  store: { id: 's1', name: STORE.name },
  variantCount: 2,
  unitsOnHand: 8,
  unitsReserved: 5,
  lowStock: 1,
  outOfStock: 1,
  unitsWithoutCost: 0,
  valuation: [{ currency: 'MAD', value: '960.00' }],
};
const apiError = (status, error) =>
  Object.assign(new Error('Request failed'), { response: { status, data: { error } } });

function signedInAs(role, permissions) {
  vi.mocked(authService.getSession).mockResolvedValue(sessionFixture({ role, permissions }));
}

beforeEach(() => {
  vi.mocked(orgService.listStores).mockResolvedValue([STORE]);
  vi.mocked(inventoryService.getInventorySummary).mockResolvedValue(SUMMARY);
  vi.mocked(inventoryService.listInventory).mockResolvedValue({
    data: [
      row(),
      row({
        variantId: 'v2',
        sku: 'SHIRT-L',
        variantName: 'L',
        onHand: 0,
        reserved: 0,
        available: 0,
        status: 'OUT',
        stockValue: '0.00',
      }),
    ],
    meta: { page: 1, pageSize: 25, total: 2, store: { id: 's1', name: STORE.name } },
  });
});

describe('inventory page', () => {
  test('shows the summary and each variant with its status', async () => {
    signedInAs('INVENTORY_MANAGER', [
      'org:read',
      'product:read',
      'inventory:read',
      'inventory:adjust',
    ]);
    renderRoute('/inventory');

    expect(await screen.findByText('Low stock', { selector: 'dt' })).toBeInTheDocument();
    const row1 = (await screen.findByText('SHIRT-M', { exact: false })).closest('tr');
    expect(within(row1).getByText('Low stock')).toBeInTheDocument();
    expect(within(row1).getAllByText('3')[0]).toBeInTheDocument();
    const row2 = screen.getByText('SHIRT-L', { exact: false }).closest('tr');
    expect(within(row2).getByText('Out of stock')).toBeInTheDocument();
    expect(inventoryService.listInventory).toHaveBeenCalledWith(
      expect.objectContaining({ storeId: 's1', page: 1 }),
    );
  });

  test('the status tabs filter through the URL', async () => {
    signedInAs('INVENTORY_MANAGER', ['org:read', 'inventory:read', 'inventory:adjust']);
    const { router } = renderRoute('/inventory');
    await userEvent.click(await screen.findByRole('tab', { name: 'Out of stock' }));
    await waitFor(() => expect(router.state.location.search).toBe('?stock=out'));
    expect(inventoryService.listInventory).toHaveBeenLastCalledWith(
      expect.objectContaining({ stock: 'out' }),
    );
    expect(screen.getByRole('tab', { name: 'Out of stock' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('receiving stock sends a whole-number quantity for the right store and variant', async () => {
    signedInAs('INVENTORY_MANAGER', ['org:read', 'inventory:read', 'inventory:adjust']);
    vi.mocked(inventoryService.receiveStock).mockResolvedValue({
      ...row(),
      onHand: 20,
      available: 15,
    });
    renderRoute('/inventory');

    await userEvent.click(await screen.findByRole('button', { name: 'Receive stock for SHIRT-M' }));
    const dialog = await screen.findByRole('dialog', { name: 'Receive stock: SHIRT-M' });
    await userEvent.type(within(dialog).getByLabelText('Quantity received'), '1.5');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Receive stock' }));
    expect(await within(dialog).findByText('Enter a whole number')).toBeInTheDocument();

    await userEvent.clear(within(dialog).getByLabelText('Quantity received'));
    await userEvent.type(within(dialog).getByLabelText('Quantity received'), '12');
    await userEvent.type(within(dialog).getByLabelText('Note (optional)'), 'PO-1001');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Receive stock' }));

    await waitFor(() => expect(inventoryService.receiveStock).toHaveBeenCalled());
    expect(vi.mocked(inventoryService.receiveStock).mock.calls[0][0]).toEqual({
      storeId: 's1',
      variantId: 'v1',
      quantity: 12,
      note: 'PO-1001',
    });
    expect(await screen.findByText('SHIRT-M: 20 on hand, 15 available.')).toBeInTheDocument();
  });

  test('a refused adjustment explains why (reserved units)', async () => {
    signedInAs('INVENTORY_MANAGER', ['org:read', 'inventory:read', 'inventory:adjust']);
    vi.mocked(inventoryService.adjustStock).mockRejectedValue(
      apiError(409, {
        code: 'INSUFFICIENT_STOCK',
        message: 'Not enough stock for this change',
        details: {
          onHand: 8,
          reserved: 5,
          available: 3,
          message: '5 units are reserved for orders',
        },
      }),
    );
    renderRoute('/inventory');

    await userEvent.click(await screen.findByRole('button', { name: 'Adjust stock for SHIRT-M' }));
    const dialog = await screen.findByRole('dialog', { name: 'Adjust stock: SHIRT-M' });
    await userEvent.click(within(dialog).getByLabelText('Set counted quantity'));
    await userEvent.type(within(dialog).getByLabelText('Counted quantity'), '2');
    await userEvent.selectOptions(within(dialog).getByLabelText('Reason'), 'COUNT_CORRECTION');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save adjustment' }));

    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent('Not enough stock for this change');
    expect(alert).toHaveTextContent('5 units are reserved for orders');
    expect(vi.mocked(inventoryService.adjustStock).mock.calls[0][0]).toMatchObject({
      setTo: 2,
      reason: 'COUNT_CORRECTION',
    });
  });

  test('"Other" requires a note before anything is sent', async () => {
    signedInAs('INVENTORY_MANAGER', ['org:read', 'inventory:read', 'inventory:adjust']);
    renderRoute('/inventory');
    await userEvent.click(await screen.findByRole('button', { name: 'Adjust stock for SHIRT-M' }));
    const dialog = await screen.findByRole('dialog', { name: 'Adjust stock: SHIRT-M' });
    await userEvent.type(within(dialog).getByLabelText('Change (use - to remove)'), '-1');
    await userEvent.selectOptions(within(dialog).getByLabelText('Reason'), 'OTHER');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save adjustment' }));
    expect(await within(dialog).findByText('Explain the adjustment')).toBeInTheDocument();
    expect(inventoryService.adjustStock).not.toHaveBeenCalled();
  });

  test('roles without inventory:adjust see stock but no receive or adjust buttons', async () => {
    signedInAs('ORDER_MANAGER', ['org:read', 'inventory:read']);
    renderRoute('/inventory');
    expect(await screen.findByText('SHIRT-M', { exact: false })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Receive stock for/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Adjust stock for/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Movement history for SHIRT-M' })).toBeInTheDocument();
  });
});

describe('movement history', () => {
  test('shows signed changes, reasons and who made them', async () => {
    signedInAs('OWNER', ['org:read', 'inventory:read', 'inventory:adjust']);
    vi.mocked(inventoryService.listMovements).mockResolvedValue({
      data: [
        {
          id: 'm2',
          type: 'ADJUSTMENT',
          reason: 'DAMAGED',
          note: 'Water damage',
          onHandDelta: -2,
          reservedDelta: 0,
          onHandAfter: 8,
          reservedAfter: 0,
          store: { id: 's1', name: STORE.name },
          variant: { id: 'v1', sku: 'SHIRT-M', name: 'M' },
          product: { id: 'p1', name: 'Linen shirt' },
          actor: { id: 'u1', name: 'Amina Haddad' },
          orderId: null,
          createdAt: '2026-10-15T10:05:00Z',
        },
        {
          id: 'm1',
          type: 'RECEIPT',
          reason: null,
          note: null,
          onHandDelta: 10,
          reservedDelta: 0,
          onHandAfter: 10,
          reservedAfter: 0,
          store: { id: 's1', name: STORE.name },
          variant: { id: 'v1', sku: 'SHIRT-M', name: 'M' },
          product: { id: 'p1', name: 'Linen shirt' },
          actor: { id: 'u1', name: 'Amina Haddad' },
          orderId: null,
          createdAt: '2026-10-15T10:00:00Z',
        },
      ],
      meta: { page: 1, pageSize: 50, total: 2 },
    });
    renderRoute('/inventory/movements?variantId=v1&sku=SHIRT-M');

    // The type filter also lists "Adjusted", so look inside the table only.
    const table = await screen.findByRole('table');
    const adjusted = within(table).getByText('Adjusted').closest('tr');
    expect(within(adjusted).getByText('-2')).toBeInTheDocument();
    expect(within(adjusted).getByText('Damaged')).toBeInTheDocument();
    expect(within(adjusted).getByText('Water damage')).toBeInTheDocument();
    expect(
      within(within(table).getByText('Received').closest('tr')).getByText('+10'),
    ).toBeInTheDocument();
    expect(inventoryService.listMovements).toHaveBeenCalledWith(
      expect.objectContaining({ variantId: 'v1' }),
    );
    expect(screen.getByRole('button', { name: 'Show all variants' })).toBeInTheDocument();
  });
});
