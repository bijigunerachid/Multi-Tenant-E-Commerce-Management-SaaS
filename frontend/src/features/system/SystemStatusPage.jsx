import { useQuery } from '@tanstack/react-query';
import { ArrowPathIcon, CheckCircleIcon, XCircleIcon } from '@heroicons/react/20/solid';
import { fetchReadiness } from '../../services/healthService.js';
import { getApiError } from '../../lib/apiClient.js';

const DEPENDENCY_LABELS = { database: 'Database', redis: 'Cache and queues' };

export function SystemStatusPage() {
  const query = useQuery({ queryKey: ['health', 'ready'], queryFn: fetchReadiness });

  return (
    <main className="mx-auto max-w-xl px-4 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Vendora</h1>
      <p className="mt-1 text-sm text-slate-600">System status</p>

      <section
        aria-labelledby="status-heading"
        aria-busy={query.isFetching}
        className="mt-8 rounded-lg border border-slate-200 bg-white shadow-sm"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 id="status-heading" className="text-sm font-medium">
            API services
          </h2>
          <button
            type="button"
            onClick={() => query.refetch()}
            disabled={query.isFetching}
            className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:opacity-50"
          >
            <ArrowPathIcon
              aria-hidden="true"
              className={`size-4 ${query.isFetching ? 'animate-spin' : ''}`}
            />
            Check again
          </button>
        </div>
        <StatusBody query={query} />
      </section>
    </main>
  );
}

function StatusBody({ query }) {
  if (query.isPending) {
    return (
      <ul className="divide-y divide-slate-100" aria-label="Loading status">
        {[0, 1].map((i) => (
          <li key={i} className="flex items-center justify-between px-5 py-4">
            <span className="h-4 w-32 animate-pulse rounded bg-slate-200" />
            <span className="h-4 w-16 animate-pulse rounded bg-slate-200" />
          </li>
        ))}
      </ul>
    );
  }

  if (query.isError) {
    const error = getApiError(query.error);
    return (
      <div role="alert" className="px-5 py-4 text-sm text-red-700">
        <p className="font-medium">The API is not responding.</p>
        <p className="mt-1 text-red-600">{error.message}</p>
      </div>
    );
  }

  const { status, checks } = query.data;
  return (
    <>
      <p
        className={`px-5 pt-4 text-sm font-medium ${status === 'ready' ? 'text-emerald-700' : 'text-amber-700'}`}
      >
        {status === 'ready' ? 'All services are operational.' : 'Some services are unavailable.'}
      </p>
      <ul className="divide-y divide-slate-100">
        {Object.entries(checks).map(([name, state]) => (
          <li key={name} className="flex items-center justify-between px-5 py-4 text-sm">
            <span>{DEPENDENCY_LABELS[name] ?? name}</span>
            {state === 'up' ? (
              <span className="inline-flex items-center gap-1 text-emerald-700">
                <CheckCircleIcon aria-hidden="true" className="size-4" /> Up
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-red-700">
                <XCircleIcon aria-hidden="true" className="size-4" /> Down
              </span>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
