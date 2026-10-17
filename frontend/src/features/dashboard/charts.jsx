import { useId, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatMoney } from '../../lib/format.js';

// Chart styling follows the data-viz method: one validated series colour (categorical slot 1),
// 2px lines, recessive grid and axes in text ink, a hover tooltip on every mark, and a table
// view so nothing depends on seeing the chart.
const SERIES = '#2a78d6';
const GRID = '#e2e8f0';
const AXIS_TEXT = '#64748b';

const shortDate = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const longDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
const parseDay = (d) => new Date(`${d}T00:00:00`);

function compactMoney(value, currency) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

function TableToggle({ children, label }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="mt-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="text-sm font-medium text-slate-600 hover:text-slate-900"
      >
        {open ? 'Hide table' : `View ${label} as a table`}
      </button>
      {open && (
        <div id={id} className="mt-2 max-h-72 overflow-auto rounded-md border border-slate-200">
          {children}
        </div>
      )}
    </div>
  );
}

function TrendTooltip({ active, payload, currency, bucket }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded-md bg-white px-3 py-2 text-sm shadow-lg ring-1 ring-slate-200">
      <p className="text-slate-600">
        {bucket === 'week'
          ? `Week of ${longDate.format(parseDay(point.period))}`
          : longDate.format(parseDay(point.period))}
      </p>
      <p className="font-semibold tabular-nums text-slate-900">
        {formatMoney(point.revenue, currency)}
      </p>
      <p className="text-slate-600">
        {point.orders} {point.orders === 1 ? 'order' : 'orders'} shipped
      </p>
    </div>
  );
}

export function RevenueChart({ points, currency, bucket }) {
  const data = points.map((p) => ({ ...p, value: Number(p.revenue) }));
  const total = data.reduce((s, p) => s + p.value, 0);
  const gradientId = useId().replace(/:/g, '');
  const summary = `Revenue by ${bucket}, ${points.length} ${bucket === 'week' ? 'weeks' : 'days'}, total ${formatMoney(total.toFixed(2), currency)}.`;

  return (
    <div>
      <div role="img" aria-label={summary} className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={SERIES} stopOpacity={0.18} />
                <stop offset="100%" stopColor={SERIES} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis
              dataKey="period"
              tickFormatter={(d) => shortDate.format(parseDay(d))}
              tick={{ fill: AXIS_TEXT, fontSize: 12 }}
              tickLine={false}
              axisLine={{ stroke: GRID }}
              minTickGap={24}
            />
            <YAxis
              tickFormatter={(v) => compactMoney(v, currency)}
              tick={{ fill: AXIS_TEXT, fontSize: 12 }}
              tickLine={false}
              axisLine={false}
              width={64}
              allowDecimals={false}
            />
            <Tooltip
              content={<TrendTooltip currency={currency} bucket={bucket} />}
              cursor={{ stroke: AXIS_TEXT, strokeDasharray: '3 3' }}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke={SERIES}
              strokeWidth={2}
              fill={`url(#${gradientId})`}
              activeDot={{ r: 5, stroke: '#ffffff', strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <TableToggle label="revenue">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th scope="col" className="px-3 py-2">
                {bucket === 'week' ? 'Week of' : 'Day'}
              </th>
              <th scope="col" className="px-3 py-2 text-right">
                Orders shipped
              </th>
              <th scope="col" className="px-3 py-2 text-right">
                Revenue
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {points.map((p) => (
              <tr key={p.period}>
                <td className="px-3 py-1.5">{longDate.format(parseDay(p.period))}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{p.orders}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">
                  {formatMoney(p.revenue, currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableToggle>
    </div>
  );
}

export function TopProductsChart({ products, currency }) {
  const data = products.map((p) => ({ ...p, value: Number(p.sales) }));
  const summary = `Top ${products.length} products by sales: ${products
    .map((p) => `${p.productName} ${formatMoney(p.sales, currency)}`)
    .join(', ')}.`;

  return (
    <div>
      <div role="img" aria-label={summary} style={{ height: Math.max(120, data.length * 44) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 0, right: 72, bottom: 0, left: 0 }}
            barCategoryGap={10}
          >
            <XAxis type="number" hide />
            <YAxis
              type="category"
              dataKey="productName"
              width={120}
              tick={{ fill: '#334155', fontSize: 12 }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              cursor={{ fill: '#f1f5f9' }}
              formatter={(value, _name, item) => [
                `${formatMoney(value.toFixed(2), currency)} · ${item.payload.units} units`,
                'Sales',
              ]}
            />
            <Bar
              dataKey="value"
              fill={SERIES}
              radius={[0, 4, 4, 0]}
              maxBarSize={22}
              isAnimationActive={false}
            >
              <LabelList
                dataKey="value"
                position="right"
                formatter={(v) => compactMoney(v, currency)}
                style={{ fill: '#334155', fontSize: 12 }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <TableToggle label="top products">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th scope="col" className="px-3 py-2">
                Product
              </th>
              <th scope="col" className="px-3 py-2 text-right">
                Units
              </th>
              <th scope="col" className="px-3 py-2 text-right">
                Sales
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {products.map((p) => (
              <tr key={p.productId}>
                <td className="px-3 py-1.5">{p.productName}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{p.units}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">
                  {formatMoney(p.sales, currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableToggle>
    </div>
  );
}
