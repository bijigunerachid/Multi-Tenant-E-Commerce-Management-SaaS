import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { renderRoute, sessionFixture } from '../../tests/renderWithProviders.jsx';
import * as authService from '../../services/authService.js';
import * as catalogService from '../../services/catalogService.js';

vi.mock('../../services/authService.js');
vi.mock('../../services/organizationService.js');
vi.mock('../../services/memberService.js');
vi.mock('../../services/catalogService.js');

const OWNER = ['org:read', 'product:read', 'product:write'];
const ANALYST = ['org:read', 'product:read'];
const listItem = (overrides = {}) => ({
  id: 'p1',
  name: 'Linen shirt',
  status: 'ACTIVE',
  category: { id: 'c1', name: 'Shirts' },
  variantCount: 2,
  skus: ['SHIRT-M', 'SHIRT-L'],
  priceMin: '29.90',
  priceMax: '31.90',
  currency: 'USD',
  image: null,
  updatedAt: '2026-10-10T10:00:00Z',
  ...overrides,
});
const page = (data, total = data.length) => ({ data, meta: { page: 1, pageSize: 20, total } });

function signedInAs(permissions, role = 'OWNER') {
  const session = sessionFixture({ role, permissions });
  session.activeOrganization.defaultCurrency = 'USD';
  vi.mocked(authService.getSession).mockResolvedValue(session);
}

beforeEach(() => {
  vi.mocked(catalogService.listCategories).mockResolvedValue([
    { id: 'c1', name: 'Shirts', slug: 'shirts', parentId: null, productCount: 1, childCount: 0 },
  ]);
});

describe('products list', () => {
  test('shows products with price ranges and keeps filters in the URL', async () => {
    signedInAs(OWNER);
    vi.mocked(catalogService.listProducts).mockResolvedValue(page([listItem()]));
    const { router } = renderRoute('/products?status=ACTIVE');

    const row = (await screen.findByRole('link', { name: 'Linen shirt' })).closest('tr');
    expect(within(row).getByText(/29\.90.*31\.90/)).toBeInTheDocument();
    expect(within(row).getByText('SHIRT-M, SHIRT-L')).toBeInTheDocument();
    expect(catalogService.listProducts).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ACTIVE', page: 1 }),
    );

    await userEvent.selectOptions(screen.getByLabelText('Category'), 'c1');
    await waitFor(() => expect(router.state.location.search).toBe('?status=ACTIVE&categoryId=c1'));
    expect(catalogService.listProducts).toHaveBeenLastCalledWith(
      expect.objectContaining({ categoryId: 'c1' }),
    );
  });

  test('distinguishes "no products yet" from "no results"', async () => {
    signedInAs(OWNER);
    vi.mocked(catalogService.listProducts).mockResolvedValue(page([]));
    renderRoute('/products');
    expect(await screen.findByText('No products yet')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /New product/ }).length).toBeGreaterThan(0);
  });

  test('offers to clear filters when nothing matches', async () => {
    signedInAs(OWNER);
    vi.mocked(catalogService.listProducts).mockResolvedValue(page([]));
    const { router } = renderRoute('/products?search=zzz');
    expect(await screen.findByText('No products match these filters')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(router.state.location.search).toBe(''));
  });

  test('read-only roles see the catalog without editing actions', async () => {
    signedInAs(ANALYST, 'ANALYST');
    vi.mocked(catalogService.listProducts).mockResolvedValue(page([listItem()]));
    renderRoute('/products');
    expect(await screen.findByRole('link', { name: 'Linen shirt' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /New product/ })).not.toBeInTheDocument();
  });
});

describe('product editor', () => {
  test('warns before leaving with unsaved changes, and leaves once confirmed', async () => {
    signedInAs(OWNER);
    vi.mocked(catalogService.listProducts).mockResolvedValue(page([]));
    const { router } = renderRoute('/products/new');
    await userEvent.type(await screen.findByLabelText('Product name'), 'Linen shirt');

    await userEvent.click(screen.getByRole('link', { name: 'Cancel' }));
    const dialog = await screen.findByRole('dialog', { name: 'Leave without saving?' });
    // Staying keeps the work.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(router.state.location.pathname).toBe('/products/new');
    expect(screen.getByLabelText('Product name')).toHaveValue('Linen shirt');

    await userEvent.click(screen.getByRole('link', { name: 'Cancel' }));
    await userEvent.click(
      within(await screen.findByRole('dialog', { name: 'Leave without saving?' })).getByRole(
        'button',
        { name: 'Leave and discard changes' },
      ),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe('/products'));
  });

  test('validates each variant row before sending anything', async () => {
    signedInAs(OWNER);
    renderRoute('/products/new');

    await userEvent.type(await screen.findByLabelText('Product name'), 'Linen shirt');
    await userEvent.type(screen.getByLabelText('Price, variant 1'), '1.999');
    await userEvent.click(screen.getByRole('button', { name: 'Create product' }));

    expect(await screen.findByText('Enter a SKU')).toBeInTheDocument();
    expect(screen.getByText('Enter a price like 19.90')).toBeInTheDocument();
    expect(screen.getByLabelText('SKU, variant 1')).toHaveAttribute('aria-invalid', 'true');
    expect(catalogService.createProduct).not.toHaveBeenCalled();
  });

  test('creates a product with options and shows a server SKU conflict on the right row', async () => {
    signedInAs(OWNER);
    vi.mocked(catalogService.createProduct).mockRejectedValue(
      Object.assign(new Error('Conflict'), {
        response: {
          status: 409,
          data: {
            error: {
              code: 'SKU_TAKEN',
              message: 'Some SKUs are already in use',
              details: {
                fieldErrors: { 'variants.1.sku': 'This SKU is already used by another product' },
              },
            },
          },
        },
      }),
    );
    renderRoute('/products/new');

    await userEvent.type(await screen.findByLabelText('Product name'), 'Linen shirt');
    await userEvent.click(screen.getByRole('button', { name: /Add option/ }));
    await userEvent.type(screen.getByLabelText('Option 1'), 'Size');
    await userEvent.type(screen.getByLabelText('Size, variant 1'), 'M');
    await userEvent.type(screen.getByLabelText('SKU, variant 1'), 'shirt-m');
    await userEvent.type(screen.getByLabelText('Price, variant 1'), '29.90');
    await userEvent.click(screen.getByRole('button', { name: 'Add variant' }));
    await userEvent.type(screen.getByLabelText('Size, variant 2'), 'L');
    await userEvent.type(screen.getByLabelText('SKU, variant 2'), 'shirt-l');
    await userEvent.type(screen.getByLabelText('Price, variant 2'), '31.90');
    await userEvent.click(screen.getByRole('button', { name: 'Create product' }));

    await waitFor(() => expect(catalogService.createProduct).toHaveBeenCalled());
    expect(vi.mocked(catalogService.createProduct).mock.calls[0][0]).toEqual({
      name: 'Linen shirt',
      description: null,
      categoryId: null,
      status: 'DRAFT',
      variants: [
        {
          sku: 'SHIRT-M',
          options: { Size: 'M' },
          price: '29.90',
          cost: null,
          lowStockThreshold: 5,
        },
        {
          sku: 'SHIRT-L',
          options: { Size: 'L' },
          price: '31.90',
          cost: null,
          lowStockThreshold: 5,
        },
      ],
    });
    expect(
      await screen.findByText('This SKU is already used by another product'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('SKU, variant 2')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('SKU, variant 1')).not.toHaveAttribute('aria-invalid');
    expect(screen.getByRole('alert')).toHaveTextContent('Some SKUs are already in use');
  });

  test('read-only roles see product details with editing disabled', async () => {
    signedInAs(ANALYST, 'ANALYST');
    vi.mocked(catalogService.getProduct).mockResolvedValue({
      id: 'p1',
      name: 'Linen shirt',
      description: null,
      status: 'ACTIVE',
      category: null,
      variants: [
        {
          id: 'v1',
          sku: 'SHIRT-M',
          options: {},
          price: '29.90',
          cost: null,
          currency: 'USD',
          lowStockThreshold: 5,
        },
      ],
      images: [],
    });
    renderRoute('/products/p1');

    expect(await screen.findByLabelText('Product name')).toBeDisabled();
    expect(
      screen.queryByRole('button', { name: /Save changes|Archive|Delete|Upload image/ }),
    ).not.toBeInTheDocument();
  });

  test('shows an error instead of an empty form when the product cannot be loaded', async () => {
    signedInAs(OWNER);
    vi.mocked(catalogService.getProduct).mockRejectedValue(
      Object.assign(new Error('Not found'), {
        response: {
          status: 404,
          data: { error: { code: 'NOT_FOUND', message: 'Product not found' } },
        },
      }),
    );
    renderRoute('/products/missing');
    expect(await screen.findByText('Product not found')).toBeInTheDocument();
    expect(screen.queryByLabelText('Product name')).not.toBeInTheDocument();
  });
});
