import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ShoppingBagIcon } from '@heroicons/react/24/outline';
import { Alert, Badge, Card, EmptyState, SkeletonRows } from '../../components/ui/layout.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { getApiError } from '../../lib/apiClient.js';
import { formatDate, formatMoney, formatSpent } from '../../lib/format.js';
import { listOrders } from '../../services/orderService.js';
import { ORDER_STATUS } from '../orders/orderLabels.js';

const RECENT = 5;

/** Spending summary. "Spent" counts placed orders that were not cancelled. */
export function CustomerStats({ stats }) {
  const cards = [
    {
      label: 'Orders',
      value: stats.orderCount,
      sub: stats.cancelledCount
        ? `${stats.cancelledCount} cancelled, not counted`
        : 'Placed, not cancelled',
    },
    { label: 'Total spent', value: formatSpent(stats.spent) },
    {
      label: 'Average order',
      value: stats.spent.length
        ? stats.spent.map((s) => formatMoney(s.averageOrder, s.currency)).join(' + ')
        : '—',
    },
    {
      label: 'Last order',
      value: stats.lastOrderAt ? formatDate(stats.lastOrderAt) : '—',
      sub: stats.firstOrderAt ? `First on ${formatDate(stats.firstOrderAt)}` : null,
    },
  ];
  return (
    <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((c) => (
        <div
          key={c.label}
          className="rounded-lg border border-slate-200 bg-white px-5 py-4 shadow-sm"
        >
          <dt className="text-sm text-slate-500">{c.label}</dt>
          <dd className="mt-1 text-xl font-semibold tabular-nums text-slate-900">{c.value}</dd>
          {c.sub && <dd className="mt-0.5 text-xs text-slate-500">{c.sub}</dd>}
        </div>
      ))}
    </dl>
  );
}

/** The customer's most recent orders, with a link to all of them on the orders page. */
export function RecentOrders({ customer }) {
  const orders = useQuery({
    queryKey: ['orders', { customerId: customer.id, recent: true }],
    queryFn: () =>
      listOrders({ customerId: customer.id, page: 1, pageSize: RECENT, sort: '-createdAt' }),
  });
  const allLink = `/orders?customerId=${customer.id}&customer=${encodeURIComponent(customer.name)}`;

  return (
    <Card
      title="Orders"
      actions={
        orders.data?.meta.total > RECENT && (
          <Link to={allLink} className="text-sm font-medium text-indigo-600 hover:text-indigo-500">
            View all {orders.data.meta.total}
          </Link>
        )
      }
    >
      {orders.isPending ? (
        <SkeletonRows rows={3} label="Loading orders" />
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
        <EmptyState icon={ShoppingBagIcon} title="No orders yet" />
      ) : (
        <ul className="-my-4 divide-y divide-slate-100">
          {orders.data.data.map((o) => (
            <li
              key={o.id}
              className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
            >
              <div className="flex items-center gap-3">
                <Link
                  to={`/orders/${o.id}`}
                  className="font-medium text-slate-900 hover:text-indigo-600"
                >
                  {o.number ? `#${o.number}` : 'Draft'}
                </Link>
                <Badge tone={ORDER_STATUS[o.status].tone}>{ORDER_STATUS[o.status].label}</Badge>
              </div>
              <span className="flex items-center gap-4 text-slate-600">
                <span>{o.placedAt ? formatDate(o.placedAt) : 'Not placed'}</span>
                <span className="font-medium tabular-nums text-slate-900">
                  {formatMoney(o.total, o.currency)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
