import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MagnifyingGlassIcon } from '@heroicons/react/20/solid';
import { Spinner } from '../../components/ui/Spinner.jsx';
import { useDebouncedValue } from '../../hooks/useDebouncedValue.js';
import { getApiError } from '../../lib/apiClient.js';
import { formatMoney } from '../../lib/format.js';
import { listCustomers } from '../../services/customerService.js';
import { searchSellableVariants } from '../../services/orderService.js';

/**
 * Search box with a list of results below it. Results are buttons, so they work with the
 * keyboard (Tab, Enter) and screen readers without custom key handling.
 */
function SearchPicker({ label, placeholder, queryKey, search, renderResult, onPick, emptyText }) {
  const id = useId();
  const [text, setText] = useState('');
  const debounced = useDebouncedValue(text.trim());
  const results = useQuery({
    queryKey: [...queryKey, debounced],
    queryFn: () => search(debounced),
    enabled: debounced.length > 0,
  });

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-slate-800">
        {label}
      </label>
      <div className="relative mt-1.5">
        <MagnifyingGlassIcon
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-2.5 size-4 text-slate-400"
        />
        <input
          id={id}
          type="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          className="block w-full rounded-md border-0 py-2 pl-9 pr-3 text-sm shadow-sm ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-600"
        />
      </div>
      {debounced && (
        <div className="mt-2 rounded-md border border-slate-200" aria-live="polite">
          {results.isPending ? (
            <p className="flex items-center gap-2 px-3 py-2 text-sm text-slate-500">
              <Spinner className="size-4" /> Searching…
            </p>
          ) : results.isError ? (
            <p role="alert" className="px-3 py-2 text-sm text-red-700">
              {getApiError(results.error).message}
            </p>
          ) : results.data.length === 0 ? (
            <p className="px-3 py-2 text-sm text-slate-500">{emptyText}</p>
          ) : (
            <ul className="max-h-64 divide-y divide-slate-100 overflow-y-auto">
              {results.data.map((r) => (
                <li key={r.id ?? r.variantId}>
                  <button
                    type="button"
                    onClick={() => {
                      onPick(r);
                      setText('');
                    }}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-indigo-50 focus-visible:bg-indigo-50 focus-visible:outline-none"
                  >
                    {renderResult(r)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function CustomerPicker({ onPick }) {
  return (
    <SearchPicker
      label="Find a customer"
      placeholder="Name, email or phone"
      queryKey={['customer-picker']}
      search={(q) => listCustomers({ search: q, pageSize: 6 }).then((r) => r.data)}
      emptyText="No customer matches. Add customers from the Customers page."
      onPick={onPick}
      renderResult={(c) => (
        <>
          <span className="font-medium text-slate-900">{c.name}</span>
          <span className="block text-xs text-slate-500">
            {[c.email, c.phone].filter(Boolean).join(' · ') || 'No contact details'}
          </span>
        </>
      )}
    />
  );
}

export function ProductPicker({ storeId, onPick }) {
  return (
    <SearchPicker
      label="Add a product"
      placeholder="Product name or SKU"
      queryKey={['sellable-variants', storeId]}
      search={(q) => searchSellableVariants({ search: q, storeId, limit: 10 })}
      emptyText="No active product matches."
      onPick={onPick}
      renderResult={(v) => (
        <span className="flex items-center justify-between gap-3">
          <span>
            <span className="font-medium text-slate-900">{v.productName}</span>
            {v.variantName !== 'Default' && (
              <span className="text-slate-600"> · {v.variantName}</span>
            )}
            <span className="block text-xs text-slate-500">{v.sku}</span>
          </span>
          <span className="text-right">
            <span className="block tabular-nums text-slate-900">
              {formatMoney(v.price, v.currency)}
            </span>
            <span
              className={`block text-xs ${v.available > 0 ? 'text-slate-500' : 'text-red-600'}`}
            >
              {v.available > 0 ? `${v.available} available` : 'Out of stock'}
            </span>
          </span>
        </span>
      )}
    />
  );
}
