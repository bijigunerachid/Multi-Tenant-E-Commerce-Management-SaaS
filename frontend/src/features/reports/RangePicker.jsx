import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { Button } from '../../components/ui/Button.jsx';

const PRESETS = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: '12 months' },
];
export const DEFAULT_DAYS = 30;

/**
 * The date range kept in the URL: `days` (a preset, default 30) or `from` and `to`.
 * Changing the range keeps the page's other parameters and returns to the first page.
 */
export function useRange() {
  const [params, setParams] = useSearchParams();
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const days = Number(params.get('days')) || (from && to ? null : DEFAULT_DAYS);
  const setRange = (next) => {
    const merged = new URLSearchParams(params);
    for (const key of ['days', 'from', 'to', 'page']) merged.delete(key);
    for (const [key, value] of Object.entries(next)) merged.set(key, value);
    setParams(merged, { replace: true });
  };
  // What the API expects: nothing for the default, else the preset or the custom range.
  const query = from && to ? { from, to } : days === DEFAULT_DAYS ? {} : { days };
  const previousLabel = days ? `previous ${days} days` : 'previous period';
  return { from, to, days, setRange, query, previousLabel };
}

/** Presets plus a custom from/to form. `current` is the range the server resolved. */
export function RangePicker({ range, current }) {
  const [custom, setCustom] = useState({
    from: range.from || current?.from || '',
    to: range.to || current?.to || '',
  });
  const [error, setError] = useState(null);
  const applyCustom = (e) => {
    e.preventDefault();
    if (!custom.from || !custom.to) return setError('Choose both dates.');
    if (custom.from > custom.to) return setError('The start date must be before the end date.');
    setError(null);
    range.setRange({ from: custom.from, to: custom.to });
  };
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div
        role="group"
        aria-label="Date range"
        className="flex flex-wrap gap-1 rounded-md bg-slate-100 p-1"
      >
        {PRESETS.map((p) => (
          <button
            key={p.days}
            type="button"
            aria-pressed={range.days === p.days}
            onClick={() => range.setRange(p.days === DEFAULT_DAYS ? {} : { days: String(p.days) })}
            className={`rounded px-3 py-1.5 text-sm font-medium ${
              range.days === p.days
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <form onSubmit={applyCustom} className="flex flex-wrap items-end gap-2">
        <label className="text-xs font-medium text-slate-600">
          From
          <input
            type="date"
            value={custom.from}
            onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
            className="mt-0.5 block rounded-md border-0 px-2 py-1.5 text-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-600"
          />
        </label>
        <label className="text-xs font-medium text-slate-600">
          To
          <input
            type="date"
            value={custom.to}
            onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
            className="mt-0.5 block rounded-md border-0 px-2 py-1.5 text-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-600"
          />
        </label>
        <Button type="submit" size="sm" variant="secondary">
          Apply
        </Button>
      </form>
      {error && (
        <p role="alert" className="w-full text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
