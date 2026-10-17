import { Link } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowDownRightIcon, ArrowUpRightIcon, MinusIcon } from '@heroicons/react/20/solid';
import { ChartBarIcon, CheckCircleIcon, ShoppingBagIcon } from '@heroicons/react/24/outline';
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  PageHeader,
  SkeletonRows,
} from '../../components/ui/layout.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { getApiError } from '../../lib/apiClient.js';
import { formatDay, formatMoney } from '../../lib/format.js';
import { getDashboard } from '../../services/reportService.js';
import { listOrders } from '../../services/orderService.js';
import { useHasPermission, useSession } from '../auth/useSession.js';
import { ORDER_STATUS } from '../orders/orderLabels.js';
import { RangePicker, useRange } from '../reports/RangePicker.jsx';
import { RevenueChart, TopProductsChart } from './charts.jsx';

const time = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' });

function Change({ value, previousLabel }) {
  if (value === null || value === undefined) {
    return <span className="text-slate-500">Nothing to compare with in the {previousLabel}</span>;
  }
  const Icon = value > 0 ? ArrowUpRightIcon : value < 0 ? ArrowDownRightIcon : MinusIcon;
  const tone = value > 0 ? 'text-emerald-700' : value < 0 ? 'text-red-700' : 'text-slate-600';
  return (
    <span className={`inline-flex items-center gap-0.5 ${tone}`}>
      <Icon aria-hidden="true" className="size-4" />
      {value > 0 ? '+' : ''}
      {value}% <span className="ml-1 text-slate-500">vs {previousLabel}</span>
    </span>
  );
}

function KpiTile({ label, value, children, to }) {
  const body = (
    <>
      <dt className="text-sm text-slate-500">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</dd>
      {children && <dd className="mt-1 text-xs">{children}</dd>}
    </>
  );
  const className = 'block rounded-lg border border-slate-200 bg-white px-5 py-4 shadow-sm';
  return to ? (
    <Link
      to={to}
      className={`${className} hover:border-indigo-300 focus-visible:outline-2 focus-visible:outline-indigo-600`}
    >
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

function RecentOrders() {
  const orders = useQuery({
    queryKey: ['orders', { dashboard: true }],
    queryFn: () => listOrders({ page: 1, pageSize: 5, sort: '-createdAt' }),
  });
  return (
    <Card
      title="Recent orders"
      actions={
        <Link to="/orders" className="text-sm font-medium text-indigo-600 hover:text-indigo-500">
          All orders
        </Link>
      }
    >
      {orders.isPending ? (
        <SkeletonRows rows={4} label="Loading recent orders" />
      ) : orders.isError ? (
        <Alert tone="error">{getApiError(orders.error).message}</Alert>
      ) : orders.data.data.length === 0 ? (
        <EmptyState icon={ShoppingBagIcon} title="No orders yet" />
      ) : (
        <ul className="-my-4 divide-y divide-slate-100">
          {orders.data.data.map((o) => (
            <li key={o.id} className="flex items-center justify-between gap-3 py-3 text-sm">
              <div className="min-w-0">
                <Link
                  to={`/orders/${o.id}`}
                  className="font-medium text-slate-900 hover:text-indigo-600"
                >
                  {o.number ? `#${o.number}` : 'Draft'}
                </Link>
                <p className="truncate text-xs text-slate-500">
                  {o.customer?.name ?? 'No customer'}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <Badge tone={ORDER_STATUS[o.status].tone}>{ORDER_STATUS[o.status].label}</Badge>
                <span className="font-medium tabular-nums">{formatMoney(o.total, o.currency)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function DashboardPage() {
  const { data: session } = useSession();
  const can = useHasPermission();
  const range = useRange();
  const params = range.query;

  const dashboard = useQuery({
    queryKey: ['dashboard', params],
    queryFn: () => getDashboard(params),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });

  const d = dashboard.data;
  const { previousLabel } = range;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={
          d
            ? `${session.activeOrganization.name} · ${formatDay(d.range.from)} – ${formatDay(d.range.to)} (${d.range.timezone})`
            : session.activeOrganization.name
        }
      />
      <div className="space-y-6">
        <RangePicker key={`${range.from}-${range.to}`} range={range} current={d?.range} />

        {dashboard.isPending ? (
          <SkeletonRows rows={6} label="Loading dashboard" />
        ) : dashboard.isError ? (
          <Alert
            tone="error"
            action={
              <Button size="sm" variant="secondary" onClick={() => dashboard.refetch()}>
                Retry
              </Button>
            }
          >
            {getApiError(dashboard.error).message}
          </Alert>
        ) : (
          <div
            className={`space-y-6 ${dashboard.isPlaceholderData ? 'opacity-60' : ''}`}
            aria-busy={dashboard.isFetching}
          >
            {d.otherCurrencyOrders > 0 && (
              <Alert tone="warning">
                {d.otherCurrencyOrders} shipped{' '}
                {d.otherCurrencyOrders === 1 ? 'order is' : 'orders are'} in another currency and
                not included in these {d.currency} figures.
              </Alert>
            )}
            <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <KpiTile label="Revenue" value={formatMoney(d.kpis.revenue.value, d.currency)}>
                <Change value={d.kpis.revenue.changePercent} previousLabel={previousLabel} />
              </KpiTile>
              <KpiTile
                label="Orders placed"
                value={d.kpis.ordersPlaced.value}
                to={can('order:read') ? '/orders' : undefined}
              >
                <Change value={d.kpis.ordersPlaced.changePercent} previousLabel={previousLabel} />
              </KpiTile>
              <KpiTile
                label="Average order value"
                value={
                  d.kpis.averageOrderValue.value
                    ? formatMoney(d.kpis.averageOrderValue.value, d.currency)
                    : '—'
                }
              >
                <Change
                  value={d.kpis.averageOrderValue.changePercent}
                  previousLabel={previousLabel}
                />
              </KpiTile>
              <KpiTile
                label="Open orders"
                value={d.kpis.openOrders}
                to={can('order:read') ? '/orders' : undefined}
              >
                <span className="text-slate-500">Pending, confirmed or processing</span>
              </KpiTile>
            </dl>

            <div className="grid gap-6 xl:grid-cols-3 [&>*]:min-w-0">
              <Card
                className="xl:col-span-2"
                title="Revenue"
                description={`Net sales of shipped orders, by ${d.range.bucket === 'week' ? 'week' : 'day'}. Excludes tax and shipping.`}
              >
                {d.kpis.shippedOrders === 0 ? (
                  <EmptyState
                    icon={ChartBarIcon}
                    title="No orders shipped in this period"
                    description="Revenue is counted when an order ships."
                  />
                ) : (
                  <RevenueChart
                    points={d.revenueTrend}
                    currency={d.currency}
                    bucket={d.range.bucket}
                  />
                )}
              </Card>
              <Card title="Top products" description="By sales of shipped orders in the period.">
                {d.topProducts.length === 0 ? (
                  <EmptyState icon={ChartBarIcon} title="No sales yet in this period" />
                ) : (
                  <TopProductsChart products={d.topProducts} currency={d.currency} />
                )}
              </Card>
            </div>

            <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
              <Card
                title="Inventory alerts"
                description={`${d.kpis.lowStockVariants} low, ${d.kpis.outOfStockVariants} out of stock (all active stores)`}
                actions={
                  can('inventory:read') && (
                    <Link
                      to="/inventory?stock=attention"
                      className="text-sm font-medium text-indigo-600 hover:text-indigo-500"
                    >
                      View all
                    </Link>
                  )
                }
              >
                {d.inventoryAlerts.length === 0 ? (
                  <EmptyState
                    icon={CheckCircleIcon}
                    title="Stock levels look healthy"
                    description="No active product is at or below its low-stock threshold."
                  />
                ) : (
                  <ul className="-my-4 divide-y divide-slate-100">
                    {d.inventoryAlerts.map((a) => (
                      <li
                        key={a.variantId}
                        className="flex items-center justify-between gap-3 py-3 text-sm"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-900">{a.productName}</p>
                          <p className="text-xs text-slate-500">
                            {a.sku}
                            {a.variantName !== 'Default' && ` · ${a.variantName}`} · threshold{' '}
                            {a.threshold}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                          <span className="tabular-nums text-slate-700">
                            {a.available} available
                          </span>
                          <Badge tone={a.status === 'OUT' ? 'danger' : 'warning'}>
                            {a.status === 'OUT' ? 'Out of stock' : 'Low stock'}
                          </Badge>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              {can('order:read') ? (
                <RecentOrders />
              ) : (
                <Card title="Catalog">
                  <dl className="text-sm">
                    <dt className="text-slate-500">Active products</dt>
                    <dd className="mt-1 text-2xl font-semibold text-slate-900">
                      {d.kpis.activeProducts}
                    </dd>
                  </dl>
                </Card>
              )}
            </div>

            <p className="text-xs text-slate-500">
              Figures updated at {time.format(new Date(d.generatedAt))} and refreshed every minute.
              Revenue counts shipped and delivered orders by ship date; orders placed exclude
              cancellations.
            </p>
          </div>
        )}
      </div>
    </>
  );
}
