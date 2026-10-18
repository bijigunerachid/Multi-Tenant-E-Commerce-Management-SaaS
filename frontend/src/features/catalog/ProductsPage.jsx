import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { MagnifyingGlassIcon, PhotoIcon, PlusIcon } from '@heroicons/react/20/solid';
import { CubeIcon } from '@heroicons/react/24/outline';
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  PageHeader,
  SkeletonRows,
} from '../../components/ui/layout.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Pagination } from '../../components/ui/Pagination.jsx';
import { useDebouncedValue } from '../../hooks/useDebouncedValue.js';
import { getApiError } from '../../lib/apiClient.js';
import { PRODUCT_STATUS, formatDate, formatPriceRange } from '../../lib/format.js';
import { listCategories, listProducts } from '../../services/catalogService.js';
import { useHasPermission } from '../auth/useSession.js';

const PAGE_SIZE = 20;
const SORT_OPTIONS = [
  { value: '-updatedAt', label: 'Recently updated' },
  { value: 'name', label: 'Name (A–Z)' },
  { value: '-name', label: 'Name (Z–A)' },
  { value: '-createdAt', label: 'Newest' },
];
const filterClass =
  'rounded-md border-0 py-2 pl-3 pr-8 text-sm text-ink-900 ring-1 ring-inset ring-ink-300 focus:ring-2 focus:ring-brand-600';

/** Search, filters and page live in the URL, so they survive reloads and the back button. */
function useProductFilters() {
  const [params, setParams] = useSearchParams();
  const filters = {
    search: params.get('search') ?? '',
    status: params.get('status') ?? '',
    categoryId: params.get('categoryId') ?? '',
    sort: params.get('sort') ?? '-updatedAt',
    page: Math.max(1, Number(params.get('page')) || 1),
  };
  const update = (changes) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries({ page: 1, ...changes })) {
      if (
        value === '' ||
        value === null ||
        value === undefined ||
        (key === 'page' && value === 1) ||
        (key === 'sort' && value === '-updatedAt')
      ) {
        next.delete(key);
      } else {
        next.set(key, String(value));
      }
    }
    setParams(next, { replace: true });
  };
  return [filters, update];
}

export function ProductsPage() {
  const can = useHasPermission();
  const navigate = useNavigate();
  const [filters, update] = useProductFilters();
  const [searchInput, setSearchInput] = useState(filters.search);
  const debouncedSearch = useDebouncedValue(searchInput);

  useEffect(() => {
    if (debouncedSearch !== filters.search) update({ search: debouncedSearch });
    // Only react to the debounced text; `update` and `filters` change on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const categories = useQuery({ queryKey: ['categories'], queryFn: listCategories });
  const products = useQuery({
    queryKey: ['products', filters],
    queryFn: () =>
      listProducts({
        page: filters.page,
        pageSize: PAGE_SIZE,
        sort: filters.sort,
        search: filters.search || undefined,
        status: filters.status || undefined,
        categoryId: filters.categoryId || undefined,
      }),
    placeholderData: keepPreviousData,
  });

  const filtered = Boolean(filters.search || filters.status || filters.categoryId);
  const clearFilters = () => {
    setSearchInput('');
    update({ search: '', status: '', categoryId: '' });
  };

  return (
    <>
      <PageHeader
        title="Products"
        description="Your catalog: products, their variants, prices and SKUs."
        actions={
          can('product:write') && (
            <Link
              to="/products/new"
              className="inline-flex items-center gap-2 rounded-md bg-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            >
              <PlusIcon aria-hidden="true" className="size-5" /> New product
            </Link>
          )
        }
      />

      <Card>
        <div className="mb-4 flex flex-wrap gap-3">
          <label className="relative min-w-[14rem] flex-1">
            <span className="sr-only">Search products</span>
            <MagnifyingGlassIcon
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-2.5 size-4 text-ink-400"
            />
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search by name or SKU…"
              className="block w-full rounded-md border-0 py-2 pl-9 pr-3 text-sm ring-1 ring-inset ring-ink-300 placeholder:text-ink-400 focus:ring-2 focus:ring-brand-600"
            />
          </label>
          <label>
            <span className="sr-only">Status</span>
            <select
              value={filters.status}
              onChange={(e) => update({ status: e.target.value })}
              className={filterClass}
            >
              <option value="">Draft and active</option>
              <option value="ACTIVE">Active</option>
              <option value="DRAFT">Draft</option>
              <option value="ARCHIVED">Archived</option>
              <option value="ALL">All statuses</option>
            </select>
          </label>
          <label>
            <span className="sr-only">Category</span>
            <select
              value={filters.categoryId}
              onChange={(e) => update({ categoryId: e.target.value })}
              className={filterClass}
            >
              <option value="">All categories</option>
              {(categories.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">Sort by</span>
            <select
              value={filters.sort}
              onChange={(e) => update({ sort: e.target.value })}
              className={filterClass}
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {products.isPending ? (
          <SkeletonRows rows={5} label="Loading products" />
        ) : products.isError ? (
          <Alert
            tone="error"
            action={
              <Button size="sm" variant="secondary" onClick={() => products.refetch()}>
                Retry
              </Button>
            }
          >
            {getApiError(products.error).message}
          </Alert>
        ) : products.data.data.length === 0 ? (
          filtered ? (
            <EmptyState
              icon={MagnifyingGlassIcon}
              title="No products match these filters"
              action={
                <Button variant="secondary" onClick={clearFilters}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={CubeIcon}
              title="No products yet"
              description="Add your first product to start tracking stock and taking orders."
              action={
                can('product:write') && (
                  <Button onClick={() => navigate('/products/new')}>New product</Button>
                )
              }
            />
          )
        ) : (
          <div
            className={`space-y-4 ${products.isPlaceholderData ? 'opacity-60' : ''}`}
            aria-busy={products.isFetching}
          >
            <div className="relative -mx-5 overflow-x-auto">
              <table className="min-w-full divide-y divide-ink-200 text-sm">
                <thead className="bg-ink-50 text-left text-[0.8125rem] font-semibold text-ink-600">
                  <tr>
                    <th scope="col" className="px-5 py-3">
                      Product
                    </th>
                    <th scope="col" className="hidden px-5 py-3 md:table-cell">
                      Category
                    </th>
                    <th scope="col" className="px-5 py-3">
                      Status
                    </th>
                    <th scope="col" className="px-5 py-3 text-right">
                      Price
                    </th>
                    <th scope="col" className="hidden px-5 py-3 text-right lg:table-cell">
                      Variants
                    </th>
                    <th scope="col" className="hidden px-5 py-3 lg:table-cell">
                      Updated
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {products.data.data.map((p) => (
                    <tr key={p.id} className="hover:bg-ink-50">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          {p.image ? (
                            <img
                              src={p.image.url}
                              alt=""
                              width={40}
                              height={40}
                              loading="lazy"
                              decoding="async"
                              className="size-10 shrink-0 rounded-md object-cover ring-1 ring-ink-200"
                            />
                          ) : (
                            <span
                              aria-hidden="true"
                              className="grid size-10 shrink-0 place-items-center rounded-md bg-ink-100 text-ink-400"
                            >
                              <PhotoIcon className="size-5" />
                            </span>
                          )}
                          <div className="min-w-0">
                            <Link
                              to={`/products/${p.id}`}
                              className="font-medium text-ink-900 hover:text-brand-600"
                            >
                              {p.name}
                            </Link>
                            <p
                              translate="no"
                              className="truncate font-mono text-[0.6875rem] text-ink-500"
                            >
                              {p.skus.join(', ')}
                              {p.variantCount > p.skus.length ? ', …' : ''}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="hidden px-5 py-3 text-ink-600 md:table-cell">
                        {p.category?.name ?? '—'}
                      </td>
                      <td className="px-5 py-3">
                        <Badge tone={PRODUCT_STATUS[p.status].tone}>
                          {PRODUCT_STATUS[p.status].label}
                        </Badge>
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums text-ink-900">
                        {formatPriceRange(p.priceMin, p.priceMax, p.currency)}
                      </td>
                      <td className="hidden px-5 py-3 text-right tabular-nums text-ink-600 lg:table-cell">
                        {p.variantCount}
                      </td>
                      <td className="hidden px-5 py-3 text-ink-500 lg:table-cell">
                        {formatDate(p.updatedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination {...products.data.meta} onPageChange={(page) => update({ page })} />
          </div>
        )}
      </Card>
    </>
  );
}
