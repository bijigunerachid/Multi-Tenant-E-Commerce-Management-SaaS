import { useQuery } from '@tanstack/react-query';
import { Alert, Badge, Card, SkeletonRows } from '../../components/ui/layout.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { getApiError } from '../../lib/apiClient.js';
import { listStores } from '../../services/organizationService.js';

/** Read-only list of the organization's stores (shown on the overview and in settings). */
export function StoresCard() {
  const stores = useQuery({ queryKey: ['stores'], queryFn: listStores });
  return (
    <Card title="Stores" description="Inventory and orders are tracked per store.">
      {stores.isPending ? (
        <SkeletonRows rows={1} label="Loading stores" />
      ) : stores.isError ? (
        <Alert
          tone="error"
          action={
            <Button size="sm" variant="secondary" onClick={() => stores.refetch()}>
              Retry
            </Button>
          }
        >
          {getApiError(stores.error).message}
        </Alert>
      ) : (
        <ul className="divide-y divide-slate-100">
          {stores.data.map((s) => (
            <li
              key={s.id}
              className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm"
            >
              <span className="font-medium text-slate-900">{s.name}</span>
              <span className="flex items-center gap-2 text-slate-500">
                {s.currency} · {s.timezone}
                <Badge tone={s.status === 'ACTIVE' ? 'success' : 'neutral'}>
                  {s.status === 'ACTIVE' ? 'Active' : 'Archived'}
                </Badge>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
