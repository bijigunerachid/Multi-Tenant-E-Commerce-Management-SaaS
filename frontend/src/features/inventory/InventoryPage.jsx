import { useEffect, useState } from 'react';
import { Link, useNavigation, useSearchParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { MagnifyingGlassIcon } from '@heroicons/react/20/solid';
import { ArchiveBoxIcon } from '@heroicons/react/24/outline';
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
import { formatMoney } from '../../lib/format.js';
import { listStores } from '../../services/organizationService.js';
import { getInventorySummary, listInventory } from '../../services/inventoryService.js';
import { useHasPermission } from '../auth/useSession.js';
import { STOCK_STATUS } from './labels.js';
import { Sku } from '../../components/ui/Sku.jsx';
import { StockDialog } from './StockDialog.jsx';

const PAGE_SIZE = 25;
const STOCK_TABS = [
  { value: '', label: 'All' },
  { value: 'attention', label: 'Needs attention' },
  { value: 'low', label: 'Low stock' },
  { value: 'out', label: 'Out of stock' },
];

function SummaryCards({ storeId }) {
  const summary = useQuery({
    queryKey: ['inventory-summary', storeId],
    queryFn: () => getInventorySummary({ storeId }),
    enabled: Boolean(storeId),
  });
  if (summary.isPending) return <SkeletonRows rows={1} label="Loading summary" />;
  if (summary.isError) return <Alert tone="error">{getApiError(summary.error).message}</Alert>;
  const s = summary.data;
  const cards = [
    {
      label: 'Units on hand',
      value: s.unitsOnHand.toLocaleString(),
      sub: `${s.unitsReserved.toLocaleString()} reserved`,
    },
    {
      label: 'Low stock',
      value: s.lowStock,
      sub: 'variants at or below their threshold',
      tone: s.lowStock > 0 ? 'text-amber-700' : '',
    },
    {
      label: 'Out of stock',
      value: s.outOfStock,
      sub: `of ${s.variantCount} variants`,
      tone: s.outOfStock > 0 ? 'text-red-700' : '',
    },
    {
      label: 'Stock value (at cost)',
      value: s.valuation.length
        ? s.valuation.map((v) => formatMoney(v.value, v.currency)).join(' + ')
        : '—',
      sub:
        s.unitsWithoutCost > 0
          ? `${s.unitsWithoutCost} stocked variants have no cost`
          : 'On hand × unit cost',
    },
  ];
  return (
    <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((c) => (
        <div key={c.label} className="rounded-lg border border-ink-200 bg-white px-5 py-4">
          <dt className="text-sm text-ink-500">{c.label}</dt>
          <dd className={`mt-1 text-2xl font-semibold tabular-nums text-ink-900 ${c.tone ?? ''}`}>
            {c.value}
          </dd>
          <dd className="mt-0.5 text-xs text-ink-500">{c.sub}</dd>
        </div>
      ))}
    </dl>
  );
}

export function InventoryPage() {
  const can = useHasPermission();
  const canAdjust = can('inventory:adjust');
  const [params, setParams] = useSearchParams();
  const filters = {
    storeId: params.get('storeId') ?? '',
    stock: params.get('stock') ?? '',
    search: params.get('search') ?? '',
    page: Math.max(1, Number(params.get('page')) || 1),
  };
  const update = (changes) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries({ page: 1, ...changes })) {
      if (v === '' || (k === 'page' && v === 1)) next.delete(k);
      else next.set(k, String(v));
    }
    setParams(next, { replace: true });
  };
  const [searchInput, setSearchInput] = useState(filters.search);
  const debouncedSearch = useDebouncedValue(searchInput);
  // A click on a result while the search is settling wins: its navigation must not be
  // replaced by the search box updating the URL.
  const navigation = useNavigation();
  useEffect(() => {
    if (navigation.state !== 'idle') return;
    if (debouncedSearch !== filters.search) update({ search: debouncedSearch });
    // Only react to the debounced text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);
  const [dialog, setDialog] = useState(null); // { action, row }

  const stores = useQuery({ queryKey: ['stores'], queryFn: listStores });
  const activeStores = (stores.data ?? []).filter((s) => s.status === 'ACTIVE');
  const storeId = filters.storeId || activeStores[0]?.id || '';

  const inventory = useQuery({
    queryKey: ['inventory', storeId, filters],
    queryFn: () =>
      listInventory({
        storeId,
        page: filters.page,
        pageSize: PAGE_SIZE,
        stock: filters.stock || undefined,
        search: filters.search || undefined,
      }),
    enabled: Boolean(storeId),
    placeholderData: keepPreviousData,
  });

  if (stores.isPending) return <SkeletonRows rows={6} label="Loading inventory" />;
  if (stores.isError) return <Alert tone="error">{getApiError(stores.error).message}</Alert>;

  return (
    <>
      <PageHeader
        title="Inventory"
        description="Stock per variant. Available = on hand minus units reserved for open orders."
        actions={
          <Link
            to={`/inventory/movements${storeId ? `?storeId=${storeId}` : ''}`}
            className="inline-flex items-center rounded-md px-3.5 py-2 text-sm font-medium text-ink-700 ring-1 ring-inset ring-ink-300 hover:bg-ink-50"
          >
            Movement history
          </Link>
        }
      />
      <div className="space-y-6">
        {activeStores.length > 1 && (
          <label className="flex items-center gap-2 text-sm">
            <span className="font-medium text-ink-800">Store</span>
            <select
              value={storeId}
              onChange={(e) => update({ storeId: e.target.value })}
              className="rounded-md border-0 py-1.5 pl-3 pr-8 text-sm ring-1 ring-inset ring-ink-300 focus:ring-2 focus:ring-brand-600"
            >
              {activeStores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <SummaryCards storeId={storeId} />

        <Card>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div
              role="tablist"
              aria-label="Stock status"
              className="flex flex-wrap gap-1 rounded-md bg-ink-100 p-1"
            >
              {STOCK_TABS.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  role="tab"
                  aria-selected={filters.stock === t.value}
                  onClick={() => update({ stock: t.value })}
                  className={`rounded px-3 py-1.5 text-sm font-medium ${
                    filters.stock === t.value
                      ? 'bg-white text-ink-900'
                      : 'text-ink-600 hover:text-ink-900'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <label className="relative min-w-[12rem] flex-1">
              <span className="sr-only">Search inventory</span>
              <MagnifyingGlassIcon
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-2.5 size-4 text-ink-400"
              />
              <input
                type="search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search by product or SKU…"
                className="block w-full rounded-md border-0 py-2 pl-9 pr-3 text-sm ring-1 ring-inset ring-ink-300 placeholder:text-ink-400 focus:ring-2 focus:ring-brand-600"
              />
            </label>
          </div>

          {inventory.isPending ? (
            <SkeletonRows rows={5} label="Loading stock" />
          ) : inventory.isError ? (
            <Alert
              tone="error"
              action={
                <Button size="sm" variant="secondary" onClick={() => inventory.refetch()}>
                  Retry
                </Button>
              }
            >
              {getApiError(inventory.error).message}
            </Alert>
          ) : inventory.data.data.length === 0 ? (
            filters.stock || filters.search ? (
              <EmptyState icon={MagnifyingGlassIcon} title="Nothing matches these filters" />
            ) : (
              <EmptyState
                icon={ArchiveBoxIcon}
                title="No products to stock yet"
                description="Create products first; their variants appear here."
                action={
                  <Link
                    to="/products/new"
                    className="text-sm font-medium text-brand-600 hover:text-brand-500"
                  >
                    New product
                  </Link>
                }
              />
            )
          ) : (
            <div className={`space-y-4 ${inventory.isPlaceholderData ? 'opacity-60' : ''}`}>
              <div className="relative -mx-5 overflow-x-auto">
                <table className="min-w-full divide-y divide-ink-200 text-sm">
                  <thead className="bg-ink-50 text-left text-[0.8125rem] font-semibold text-ink-600">
                    <tr>
                      <th scope="col" className="px-5 py-3">
                        Product
                      </th>
                      <th scope="col" className="px-3 py-3 text-right">
                        On hand
                      </th>
                      <th scope="col" className="hidden px-3 py-3 text-right sm:table-cell">
                        Reserved
                      </th>
                      <th scope="col" className="px-3 py-3 text-right">
                        Available
                      </th>
                      <th scope="col" className="px-3 py-3">
                        Status
                      </th>
                      <th scope="col" className="hidden px-3 py-3 text-right lg:table-cell">
                        Value
                      </th>
                      <th scope="col" className="px-5 py-3">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100">
                    {inventory.data.data.map((r) => (
                      <tr key={r.variantId}>
                        <td className="px-5 py-3">
                          <Link
                            to={`/products/${r.productId}`}
                            className="font-medium text-ink-900 hover:text-brand-600"
                          >
                            {r.productName}
                          </Link>
                          <p className="text-xs text-ink-500">
                            <Sku>{r.sku}</Sku>
                            {r.variantName !== 'Default' && ` · ${r.variantName}`}
                          </p>
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">{r.onHand}</td>
                        <td className="hidden px-3 py-3 text-right tabular-nums text-ink-500 sm:table-cell">
                          {r.reserved}
                        </td>
                        <td className="px-3 py-3 text-right font-medium tabular-nums">
                          {r.available}
                        </td>
                        <td className="px-3 py-3">
                          <Badge tone={STOCK_STATUS[r.status].tone}>
                            {STOCK_STATUS[r.status].label}
                          </Badge>
                        </td>
                        <td className="hidden px-3 py-3 text-right tabular-nums text-ink-600 lg:table-cell">
                          {r.stockValue === null ? '—' : formatMoney(r.stockValue, r.currency)}
                        </td>
                        <td className="whitespace-nowrap px-5 py-3 text-right">
                          {canAdjust && (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                aria-label={`Receive stock for ${r.sku}`}
                                onClick={() => setDialog({ action: 'receive', row: r })}
                              >
                                Receive
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                aria-label={`Adjust stock for ${r.sku}`}
                                onClick={() => setDialog({ action: 'adjust', row: r })}
                              >
                                Adjust
                              </Button>
                            </>
                          )}
                          <Link
                            to={`/inventory/movements?variantId=${r.variantId}&storeId=${storeId}&sku=${encodeURIComponent(r.sku)}`}
                            aria-label={`Movement history for ${r.sku}`}
                            className="ml-1 rounded-md px-2.5 py-1.5 text-sm font-medium text-ink-700 hover:bg-ink-100"
                          >
                            History
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination
                page={inventory.data.meta.page}
                pageSize={inventory.data.meta.pageSize}
                total={inventory.data.meta.total}
                onPageChange={(page) => update({ page })}
              />
            </div>
          )}
        </Card>
      </div>
      {dialog && (
        <StockDialog
          action={dialog.action}
          row={dialog.row}
          storeId={storeId}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}
