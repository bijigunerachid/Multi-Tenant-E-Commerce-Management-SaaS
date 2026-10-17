import { Link, useSearchParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowDownTrayIcon, ChartBarIcon } from '@heroicons/react/24/outline';
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
import { getApiError } from '../../lib/apiClient.js';
import { formatDay, formatMoney } from '../../lib/format.js';
import { listStores } from '../../services/organizationService.js';
import { downloadReport, getReport } from '../../services/reportService.js';
import { useHasPermission } from '../auth/useSession.js';
import { RevenueChart } from '../dashboard/charts.jsx';
import { RangePicker, useRange } from './RangePicker.jsx';

const REPORTS = {
  sales: {
    label: 'Sales',
    description: 'Shipped orders over time: gross and net sales, discounts, tax and shipping.',
  },
  products: {
    label: 'Products',
    description: 'Units and sales per product variant, before order discounts.',
  },
  stores: { label: 'Stores', description: 'Orders shipped and net sales per store.' },
};
const GROUPINGS = { day: 'Day', week: 'Week', month: 'Month' };
const PAGE_SIZE = 50;
const selectClass =
  'rounded-md border-0 py-1.5 pl-3 pr-8 text-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-600';
const th = 'px-3 py-3 text-right';
const td = 'whitespace-nowrap px-3 py-2.5 text-right tabular-nums';

function periodText(row, groupBy) {
  if (groupBy === 'day') return formatDay(row.periodStart);
  return `${formatDay(row.periodStart)} – ${formatDay(row.periodEnd)}`;
}

function Table({ head, children, foot }) {
  return (
    <div className="relative -mx-5 -my-4 overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
          <tr>{head}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
        {foot && (
          <tfoot className="border-t-2 border-slate-200 bg-slate-50 font-semibold text-slate-900">
            <tr>{foot}</tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

function SalesReport({ data }) {
  const money = (v) => formatMoney(v, data.currency);
  const t = data.totals;
  return (
    <>
      <Card title="Net sales" description="Subtotal minus discounts, by ship date.">
        {t.orders === 0 ? (
          <EmptyState
            icon={ChartBarIcon}
            title="No orders shipped in this period"
            description="Sales are counted when an order ships."
          />
        ) : (
          <RevenueChart
            points={data.rows.map((r) => ({
              period: r.periodStart,
              revenue: r.netSales,
              orders: r.orders,
            }))}
            currency={data.currency}
            bucket={data.range.groupBy}
            showTable={false}
          />
        )}
      </Card>
      <Card title="By period">
        <Table
          head={
            <>
              <th scope="col" className="px-5 py-3">
                Period
              </th>
              <th scope="col" className={th}>
                Orders
              </th>
              <th scope="col" className={th}>
                Units
              </th>
              <th scope="col" className={th}>
                Gross sales
              </th>
              <th scope="col" className={th}>
                Discounts
              </th>
              <th scope="col" className={th}>
                Net sales
              </th>
              <th scope="col" className={th}>
                Tax
              </th>
              <th scope="col" className={th}>
                Shipping
              </th>
              <th scope="col" className={`${th} pr-5`}>
                Total
              </th>
            </>
          }
          foot={
            <>
              <th scope="row" className="px-5 py-3 text-left">
                Total
              </th>
              <td className={td}>{t.orders}</td>
              <td className={td}>{t.units}</td>
              <td className={td}>{money(t.grossSales)}</td>
              <td className={td}>{money(t.discounts)}</td>
              <td className={td}>{money(t.netSales)}</td>
              <td className={td}>{money(t.tax)}</td>
              <td className={td}>{money(t.shipping)}</td>
              <td className={`${td} pr-5`}>{money(t.total)}</td>
            </>
          }
        >
          {data.rows.map((r) => (
            <tr key={r.periodStart} className={r.orders ? '' : 'text-slate-400'}>
              <th scope="row" className="whitespace-nowrap px-5 py-2.5 text-left font-normal">
                {periodText(r, data.range.groupBy)}
              </th>
              <td className={td}>{r.orders}</td>
              <td className={td}>{r.units}</td>
              <td className={td}>{money(r.grossSales)}</td>
              <td className={td}>{money(r.discounts)}</td>
              <td className={`${td} font-medium`}>{money(r.netSales)}</td>
              <td className={td}>{money(r.tax)}</td>
              <td className={td}>{money(r.shipping)}</td>
              <td className={`${td} pr-5`}>{money(r.total)}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}

function ProductsReport({ data, onPageChange }) {
  const money = (v) => formatMoney(v, data.currency);
  if (data.rows.length === 0) {
    return (
      <Card>
        <EmptyState icon={ChartBarIcon} title="No products sold in this period" />
      </Card>
    );
  }
  return (
    <Card
      title="Sales by product"
      description="Line totals of shipped orders, before order-level discounts."
    >
      <div className="space-y-8">
        <Table
          head={
            <>
              <th scope="col" className="px-5 py-3">
                Product
              </th>
              <th scope="col" className={th}>
                Units
              </th>
              <th scope="col" className={th}>
                Orders
              </th>
              <th scope="col" className={th}>
                Sales
              </th>
              <th scope="col" className={`${th} pr-5`}>
                Share
              </th>
            </>
          }
          foot={
            <>
              <th scope="row" className="px-5 py-3 text-left">
                All {data.totals.variants} variants
              </th>
              <td className={td}>{data.totals.units}</td>
              <td className={td} />
              <td className={td}>{money(data.totals.sales)}</td>
              <td className={`${td} pr-5`}>100%</td>
            </>
          }
        >
          {data.rows.map((r) => (
            <tr key={r.variantId}>
              <th scope="row" className="px-5 py-2.5 text-left font-normal">
                <Link
                  to={`/products/${r.productId}`}
                  className="font-medium text-slate-900 hover:text-indigo-600"
                >
                  {r.productName}
                </Link>
                <span className="block text-xs text-slate-500">
                  {r.sku}
                  {r.variantName !== 'Default' && ` · ${r.variantName}`}
                </span>
              </th>
              <td className={td}>{r.units}</td>
              <td className={td}>{r.orders}</td>
              <td className={`${td} font-medium`}>{money(r.sales)}</td>
              <td className={`${td} pr-5`}>{r.sharePercent}%</td>
            </tr>
          ))}
        </Table>
        <Pagination
          page={data.meta.page}
          pageSize={data.meta.pageSize}
          total={data.meta.total}
          onPageChange={onPageChange}
        />
      </div>
    </Card>
  );
}

function StoresReport({ data }) {
  const money = (v) => formatMoney(v, data.currency);
  const t = data.totals;
  return (
    <Card title="Sales by store">
      <Table
        head={
          <>
            <th scope="col" className="px-5 py-3">
              Store
            </th>
            <th scope="col" className={th}>
              Orders
            </th>
            <th scope="col" className={th}>
              Net sales
            </th>
            <th scope="col" className={`${th} pr-5`}>
              Average order
            </th>
          </>
        }
        foot={
          <>
            <th scope="row" className="px-5 py-3 text-left">
              All stores
            </th>
            <td className={td}>{t.orders}</td>
            <td className={td}>{money(t.netSales)}</td>
            <td className={`${td} pr-5`}>{money(t.averageOrderValue)}</td>
          </>
        }
      >
        {data.rows.map((r) => (
          <tr key={r.storeId}>
            <th scope="row" className="px-5 py-2.5 text-left font-medium text-slate-900">
              <span className="flex flex-wrap items-center gap-2">
                {r.name}
                {r.status !== 'ACTIVE' && <Badge>Archived</Badge>}
              </span>
            </th>
            <td className={td}>{r.orders}</td>
            <td className={`${td} font-medium`}>{money(r.netSales)}</td>
            <td className={`${td} pr-5`}>{money(r.averageOrderValue)}</td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}

export function ReportsPage() {
  const can = useHasPermission();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const range = useRange();
  const report = REPORTS[params.get('report')] ? params.get('report') : 'sales';
  const groupBy = GROUPINGS[params.get('groupBy')] ? params.get('groupBy') : 'day';
  const storeId = params.get('storeId') ?? '';
  const page = Math.max(1, Number(params.get('page')) || 1);

  const update = (changes) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next, { replace: true });
  };

  // Only the parameters each report accepts are sent.
  const query = {
    ...range.query,
    ...(report !== 'stores' && storeId ? { storeId } : {}),
    ...(report === 'sales' ? { groupBy } : {}),
  };
  const pageQuery = report === 'products' ? { page, pageSize: PAGE_SIZE } : {};

  const result = useQuery({
    queryKey: ['reports', report, query, pageQuery],
    queryFn: () => getReport(report, { ...query, ...pageQuery }),
    // Keep showing the previous figures while new ones load, but only for the same report:
    // another report's data has a different shape.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === report ? previous : undefined,
  });
  const stores = useQuery({ queryKey: ['stores'], queryFn: listStores });
  const exporting = useMutation({
    mutationFn: () => downloadReport(report, query),
    onSuccess: (name) => toast.success(`Downloaded ${name}.`),
    onError: (e) => toast.error(getApiError(e).message),
  });

  const d = result.data;
  const tabLink = (key) => {
    const next = new URLSearchParams(params);
    next.set('report', key);
    next.delete('page');
    return `?${next}`;
  };

  return (
    <>
      <PageHeader
        title="Reports"
        description={
          d
            ? `${formatDay(d.range.from)} – ${formatDay(d.range.to)} (${d.range.timezone}) · ${d.currency}`
            : REPORTS[report].description
        }
        actions={
          can('report:export') && (
            <Button
              variant="secondary"
              loading={exporting.isPending}
              disabled={!d}
              onClick={() => exporting.mutate()}
            >
              <ArrowDownTrayIcon aria-hidden="true" className="size-4" /> Export CSV
            </Button>
          )
        }
      />
      <div className="space-y-6">
        <nav aria-label="Reports" className="flex gap-6 border-b border-slate-200">
          {Object.entries(REPORTS).map(([key, r]) => (
            <Link
              key={key}
              to={tabLink(key)}
              replace
              aria-current={report === key ? 'page' : undefined}
              className={`-mb-px border-b-2 px-1 pb-3 text-sm font-medium ${
                report === key
                  ? 'border-indigo-600 text-indigo-700'
                  : 'border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900'
              }`}
            >
              {r.label}
            </Link>
          ))}
        </nav>

        <div className="flex flex-wrap items-end gap-3">
          <RangePicker key={`${range.from}-${range.to}`} range={range} current={d?.range} />
          {report !== 'stores' && (
            <label className="text-xs font-medium text-slate-600">
              Store
              <select
                value={storeId}
                onChange={(e) => update({ storeId: e.target.value, page: null })}
                className={`mt-0.5 block ${selectClass}`}
              >
                <option value="">All stores</option>
                {(stores.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {report === 'sales' && (
            <label className="text-xs font-medium text-slate-600">
              Group by
              <select
                value={groupBy}
                onChange={(e) =>
                  update({ groupBy: e.target.value === 'day' ? null : e.target.value })
                }
                className={`mt-0.5 block ${selectClass}`}
              >
                {Object.entries(GROUPINGS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {result.isPending ? (
          <SkeletonRows rows={6} label="Loading report" />
        ) : result.isError ? (
          <Alert
            tone="error"
            action={
              <Button size="sm" variant="secondary" onClick={() => result.refetch()}>
                Retry
              </Button>
            }
          >
            {getApiError(result.error).message}
          </Alert>
        ) : (
          <div
            className={`space-y-6 ${result.isPlaceholderData ? 'opacity-60' : ''}`}
            aria-busy={result.isFetching}
          >
            {d.otherCurrencyOrders > 0 && (
              <Alert tone="warning">
                {d.otherCurrencyOrders} shipped{' '}
                {d.otherCurrencyOrders === 1 ? 'order is' : 'orders are'} in another currency and
                not included in these {d.currency} figures.
              </Alert>
            )}
            {report === 'sales' && <SalesReport data={d} />}
            {report === 'products' && (
              <ProductsReport data={d} onPageChange={(p) => update({ page: String(p) })} />
            )}
            {report === 'stores' && <StoresReport data={d} />}
            <p className="text-xs text-slate-500">
              Sales count shipped and delivered orders by ship date, in the organization&apos;s time
              zone and default currency. Net sales exclude tax and shipping.
            </p>
          </div>
        )}
      </div>
    </>
  );
}
