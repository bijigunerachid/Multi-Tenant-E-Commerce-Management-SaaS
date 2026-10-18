import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { ArrowDownTrayIcon, MagnifyingGlassIcon, PlusIcon } from '@heroicons/react/20/solid';
import { ShoppingBagIcon } from '@heroicons/react/24/outline';
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
import { useToast } from '../../components/ui/Toast.jsx';
import { useDebouncedValue } from '../../hooks/useDebouncedValue.js';
import { getApiError } from '../../lib/apiClient.js';
import { formatDate, formatMoney } from '../../lib/format.js';
import { downloadOrderExport, listOrders } from '../../services/orderService.js';
import { useHasPermission } from '../auth/useSession.js';
import { ORDER_STATUS } from './orderLabels.js';

const PAGE_SIZE = 25;
const TABS = [
  '',
  'DRAFT',
  'PENDING',
  'CONFIRMED',
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
];
const inputClass =
  'rounded-md border-0 py-2 px-3 text-sm ring-1 ring-inset ring-ink-300 focus:ring-2 focus:ring-brand-600';

export function OrdersPage() {
  const can = useHasPermission();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const filters = {
    status: params.get('status') ?? '',
    search: params.get('search') ?? '',
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
    customerId: params.get('customerId') ?? '',
    // Display name for the customer filter chip (the id is what is sent to the API).
    customerName: params.get('customer') ?? '',
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
  useEffect(() => {
    if (debouncedSearch !== filters.search) update({ search: debouncedSearch });
    // Only react to the debounced text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const query = {
    status: filters.status || undefined,
    search: filters.search || undefined,
    from: filters.from || undefined,
    to: filters.to || undefined,
    customerId: filters.customerId || undefined,
  };
  const orders = useQuery({
    queryKey: ['orders', filters],
    queryFn: () => listOrders({ ...query, page: filters.page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
  const exporting = useMutation({
    mutationFn: () => downloadOrderExport(query),
    onSuccess: (name) => toast.success(`Downloaded ${name}.`),
    onError: (e) => toast.error(getApiError(e).message),
  });
  const filtered = Boolean(
    filters.status || filters.search || filters.from || filters.to || filters.customerId,
  );

  return (
    <>
      <PageHeader
        title="Orders"
        description="Every order and where it is in its lifecycle."
        actions={
          <>
            <Button
              variant="secondary"
              loading={exporting.isPending}
              onClick={() => exporting.mutate()}
            >
              <ArrowDownTrayIcon aria-hidden="true" className="size-4" /> Export CSV
            </Button>
            {can('order:write') && (
              <Link
                to="/orders/new"
                className="inline-flex items-center gap-2 rounded-md bg-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
              >
                <PlusIcon aria-hidden="true" className="size-5" /> New order
              </Link>
            )}
          </>
        }
      />
      <Card>
        <div
          role="tablist"
          aria-label="Order status"
          className="-mx-1 mb-4 flex gap-1 overflow-x-auto pb-1"
        >
          {TABS.map((status) => (
            <button
              key={status || 'all'}
              type="button"
              role="tab"
              aria-selected={filters.status === status}
              onClick={() => update({ status })}
              className={`shrink-0 rounded-md px-3 py-1.5 text-sm font-medium ${
                filters.status === status
                  ? 'bg-brand-50 text-brand-700'
                  : 'text-ink-600 hover:bg-ink-100'
              }`}
            >
              {status ? ORDER_STATUS[status].label : 'All'}
            </button>
          ))}
        </div>
        {filters.customerId && (
          <p className="mb-3 inline-flex items-center gap-2 rounded-full bg-brand-50 py-1 pl-3 pr-1 text-sm text-brand-700">
            Customer: {filters.customerName || 'selected customer'}
            <button
              type="button"
              aria-label="Show orders of all customers"
              onClick={() => update({ customerId: '', customer: '' })}
              className="rounded-full px-1.5 hover:bg-brand-100"
            >
              ×
            </button>
          </p>
        )}
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <label className="relative min-w-[14rem] flex-1">
            <span className="sr-only">Search orders</span>
            <MagnifyingGlassIcon
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-2.5 size-4 text-ink-400"
            />
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Order number, customer or SKU…"
              className={`${inputClass} block w-full pl-9 placeholder:text-ink-400`}
            />
          </label>
          <label className="text-sm">
            <span className="block text-xs font-medium text-ink-600">Placed from</span>
            <input
              type="date"
              value={filters.from}
              max={filters.to || undefined}
              onChange={(e) => update({ from: e.target.value })}
              className={inputClass}
            />
          </label>
          <label className="text-sm">
            <span className="block text-xs font-medium text-ink-600">to</span>
            <input
              type="date"
              value={filters.to}
              min={filters.from || undefined}
              onChange={(e) => update({ to: e.target.value })}
              className={inputClass}
            />
          </label>
        </div>

        {orders.isPending ? (
          <SkeletonRows rows={5} label="Loading orders" />
        ) : orders.isError ? (
          <Alert
            tone="error"
            action={
              <Button size="sm" variant="secondary" onClick={() => orders.refetch()}>
                Retry
              </Button>
            }
          >
            {getApiError(orders.error).message}
          </Alert>
        ) : orders.data.data.length === 0 ? (
          filtered ? (
            <EmptyState
              icon={MagnifyingGlassIcon}
              title="No orders match these filters"
              action={
                <Button
                  variant="secondary"
                  onClick={() => {
                    setSearchInput('');
                    update({
                      status: '',
                      search: '',
                      from: '',
                      to: '',
                      customerId: '',
                      customer: '',
                    });
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={ShoppingBagIcon}
              title="No orders yet"
              description="Orders you create appear here, from draft to delivery."
              action={
                can('order:write') && (
                  <Link
                    to="/orders/new"
                    className="text-sm font-medium text-brand-600 hover:text-brand-500"
                  >
                    Create the first order
                  </Link>
                )
              }
            />
          )
        ) : (
          <div className={`space-y-4 ${orders.isPlaceholderData ? 'opacity-60' : ''}`}>
            <div className="relative -mx-5 overflow-x-auto">
              <table className="min-w-full divide-y divide-ink-200 text-sm">
                <thead className="bg-ink-50 text-left text-[0.8125rem] font-semibold text-ink-600">
                  <tr>
                    <th scope="col" className="px-5 py-3">
                      Order
                    </th>
                    <th scope="col" className="px-3 py-3">
                      Customer
                    </th>
                    <th scope="col" className="px-3 py-3">
                      Status
                    </th>
                    <th scope="col" className="hidden px-3 py-3 text-right sm:table-cell">
                      Items
                    </th>
                    <th scope="col" className="px-3 py-3 text-right">
                      Total
                    </th>
                    <th scope="col" className="hidden px-5 py-3 md:table-cell">
                      Placed
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {orders.data.data.map((o) => (
                    <tr key={o.id} className="hover:bg-ink-50">
                      <td className="whitespace-nowrap px-5 py-3">
                        <Link
                          to={`/orders/${o.id}`}
                          className="font-mono text-[0.8125rem] font-medium tabular-nums text-ink-900 hover:text-brand-600"
                        >
                          {o.number ? `#${o.number}` : 'Draft'}
                        </Link>
                      </td>
                      <td className="px-3 py-3 text-ink-700">
                        {o.customer?.name ?? <span className="text-ink-400">No customer</span>}
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={ORDER_STATUS[o.status].tone}>
                          {ORDER_STATUS[o.status].label}
                        </Badge>
                      </td>
                      <td className="hidden px-3 py-3 text-right tabular-nums text-ink-600 sm:table-cell">
                        {o.itemCount}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums font-medium">
                        {formatMoney(o.total, o.currency)}
                      </td>
                      <td className="hidden px-5 py-3 text-ink-500 md:table-cell">
                        {o.placedAt ? formatDate(o.placedAt) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={orders.data.meta.page}
              pageSize={orders.data.meta.pageSize}
              total={orders.data.meta.total}
              onPageChange={(page) => update({ page })}
            />
          </div>
        )}
      </Card>
    </>
  );
}
