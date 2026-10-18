import { useEffect, useState } from 'react';
import { Sku } from '../../components/ui/Sku.jsx';

// The homepage hero: a slice of a store's inventory, drawn with the app's own pieces (shelf
// labels, stock badges). It is an example, labelled as such, not customer data.
//
// One moment of motion: shortly after the page opens, a sale takes two poufs off the shelf and
// the row turns "Low stock". With reduced motion, the settled state is shown from the start.

const ROWS = [
  { name: 'Linen shirt', variant: 'Natural, M', sku: 'SHIRT-LIN-M', available: 34 },
  { name: 'Leather pouf', variant: 'Tan', sku: 'POUF-TAN', available: 6, sells: 2, threshold: 5 },
  { name: 'Zellige mug', variant: 'Cobalt', sku: 'MUG-ZEL-01', available: 120 },
  { name: 'Brass lantern', variant: 'Small', sku: 'LANT-BR-S', available: 12 },
];

function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  );
}

export function ShelfPreview() {
  const [sold, setSold] = useState(prefersReducedMotion);
  useEffect(() => {
    if (sold) return undefined;
    const timer = setTimeout(() => setSold(true), 1400);
    return () => clearTimeout(timer);
  }, [sold]);

  return (
    <figure
      className="overflow-hidden rounded-lg border border-ink-200 bg-white shadow-[0_24px_48px_-24px_rgb(22_60_51/0.35)]"
      aria-label="Example: a store's inventory in Vendora, where a sale brings a product to low stock"
    >
      <div aria-hidden="true">
        <div className="flex items-center justify-between gap-3 border-b border-ink-200 bg-ink-50 px-4 py-3">
          <p className="text-sm font-semibold text-ink-900">Harbor store · Inventory</p>
          <p className="text-xs text-ink-500">Example</p>
        </div>
        <ul className="divide-y divide-ink-100">
          {ROWS.map((row) => {
            const available = sold && row.sells ? row.available - row.sells : row.available;
            const low = row.threshold !== undefined && available <= row.threshold;
            return (
              <li
                key={row.sku}
                className={`flex items-center justify-between gap-3 px-4 py-3 ${low ? 'bg-amber-50/70' : ''}`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-ink-900">
                    {row.name}
                  </span>
                  <span className="mt-1 flex items-center gap-2 text-xs text-ink-500">
                    <Sku>{row.sku}</Sku>
                    <span className="truncate">{row.variant}</span>
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  <span className="w-9 text-right text-base font-semibold tabular-nums text-ink-900">
                    {available}
                  </span>
                  <span
                    key={low ? 'low' : 'ok'}
                    className={`inline-flex w-[5.5rem] justify-center whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                      low
                        ? 'bg-amber-50 text-amber-800 ring-amber-600/25 motion-safe:animate-[label-in_450ms_ease-out]'
                        : 'bg-ink-50 text-ink-600 ring-ink-300/60'
                    }`}
                  >
                    {low ? 'Low stock' : 'In stock'}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
        <p className="border-t border-ink-200 px-4 py-2.5 text-xs text-ink-500">
          {sold ? 'Order #1042 placed · 2 units reserved' : 'Waiting for orders'}
        </p>
      </div>
    </figure>
  );
}
