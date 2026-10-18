import { Link, useSearchParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { XMarkIcon } from '@heroicons/react/20/solid';
import { ClockIcon } from '@heroicons/react/24/outline';
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
import { getApiError } from '../../lib/apiClient.js';
import { listMovements } from '../../services/inventoryService.js';
import { Sku } from '../../components/ui/Sku.jsx';
import { MOVEMENT_TYPES, REASON_LABELS, signed } from './labels.js';

const PAGE_SIZE = 50;
const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** Append-only history of every stock change, newest first. */
export function MovementsPage() {
  const [params, setParams] = useSearchParams();
  const filters = {
    storeId: params.get('storeId') ?? '',
    variantId: params.get('variantId') ?? '',
    sku: params.get('sku') ?? '',
    type: params.get('type') ?? '',
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

  const movements = useQuery({
    queryKey: ['inventory-movements', filters],
    queryFn: () =>
      listMovements({
        page: filters.page,
        pageSize: PAGE_SIZE,
        storeId: filters.storeId || undefined,
        variantId: filters.variantId || undefined,
        type: filters.type || undefined,
      }),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader
        title="Movement history"
        description="Every stock change, who made it and why. Entries cannot be edited or deleted."
      />
      <Card>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <label>
            <span className="sr-only">Movement type</span>
            <select
              value={filters.type}
              onChange={(e) => update({ type: e.target.value })}
              className="rounded-md border-0 py-2 pl-3 pr-8 text-sm ring-1 ring-inset ring-ink-300 focus:ring-2 focus:ring-brand-600"
            >
              <option value="">All movements</option>
              {Object.entries(MOVEMENT_TYPES).map(([value, t]) => (
                <option key={value} value={value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          {filters.variantId && (
            <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 py-1 pl-3 pr-1 text-sm text-brand-700">
              {filters.sku || 'One variant'}
              <button
                type="button"
                onClick={() => update({ variantId: '', sku: '' })}
                aria-label="Show all variants"
                className="rounded-full p-0.5 hover:bg-brand-100"
              >
                <XMarkIcon aria-hidden="true" className="size-4" />
              </button>
            </span>
          )}
        </div>

        {movements.isPending ? (
          <SkeletonRows rows={6} label="Loading history" />
        ) : movements.isError ? (
          <Alert
            tone="error"
            action={
              <Button size="sm" variant="secondary" onClick={() => movements.refetch()}>
                Retry
              </Button>
            }
          >
            {getApiError(movements.error).message}
          </Alert>
        ) : movements.data.data.length === 0 ? (
          <EmptyState
            icon={ClockIcon}
            title="No stock movements yet"
            description="Receiving and adjusting stock records an entry here."
            action={
              <Link
                to="/inventory"
                className="text-sm font-medium text-brand-600 hover:text-brand-500"
              >
                Go to inventory
              </Link>
            }
          />
        ) : (
          <div className={`space-y-4 ${movements.isPlaceholderData ? 'opacity-60' : ''}`}>
            <div className="relative -mx-5 overflow-x-auto">
              <table className="min-w-full divide-y divide-ink-200 text-sm">
                <thead className="bg-ink-50 text-left text-[0.8125rem] font-semibold text-ink-600">
                  <tr>
                    <th scope="col" className="px-5 py-3">
                      When
                    </th>
                    <th scope="col" className="px-3 py-3">
                      Product
                    </th>
                    <th scope="col" className="px-3 py-3">
                      Movement
                    </th>
                    <th scope="col" className="px-3 py-3 text-right">
                      Change
                    </th>
                    <th scope="col" className="px-3 py-3 text-right">
                      On hand after
                    </th>
                    <th scope="col" className="hidden px-3 py-3 md:table-cell">
                      Reason / note
                    </th>
                    <th scope="col" className="hidden px-5 py-3 lg:table-cell">
                      By
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {movements.data.data.map((m) => {
                    const delta = m.onHandDelta !== 0 ? m.onHandDelta : m.reservedDelta;
                    return (
                      <tr key={m.id}>
                        <td className="whitespace-nowrap px-5 py-3 text-ink-600">
                          {dateTime.format(new Date(m.createdAt))}
                        </td>
                        <td className="px-3 py-3">
                          <Link
                            to={`/products/${m.product.id}`}
                            className="font-medium text-ink-900 hover:text-brand-600"
                          >
                            {m.product.name}
                          </Link>
                          <p className="text-xs text-ink-500">
                            <Sku>{m.variant.sku}</Sku> · {m.store.name}
                          </p>
                        </td>
                        <td className="px-3 py-3">
                          <Badge tone={MOVEMENT_TYPES[m.type].tone}>
                            {MOVEMENT_TYPES[m.type].label}
                          </Badge>
                        </td>
                        <td
                          className={`px-3 py-3 text-right font-medium tabular-nums ${delta < 0 ? 'text-red-700' : 'text-emerald-700'}`}
                        >
                          {signed(delta)}
                          {m.onHandDelta === 0 && (
                            <span className="block text-xs font-normal text-ink-500">reserved</span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">{m.onHandAfter}</td>
                        <td className="hidden px-3 py-3 text-ink-600 md:table-cell">
                          {m.reason && <span className="block">{REASON_LABELS[m.reason]}</span>}
                          {m.note && <span className="block text-xs text-ink-500">{m.note}</span>}
                          {!m.reason && !m.note && '—'}
                        </td>
                        <td className="hidden px-5 py-3 text-ink-600 lg:table-cell">
                          {m.actor?.name ?? 'System'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination
              page={movements.data.meta.page}
              pageSize={movements.data.meta.pageSize}
              total={movements.data.meta.total}
              onPageChange={(page) => update({ page })}
            />
          </div>
        )}
      </Card>
    </>
  );
}
