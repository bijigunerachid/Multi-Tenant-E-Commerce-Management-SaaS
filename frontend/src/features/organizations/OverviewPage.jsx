import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Alert, Badge, Card, PageHeader, SkeletonRows } from '../../components/ui/layout.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { getApiError } from '../../lib/apiClient.js';
import { ROLE_LABELS } from '../../lib/roles.js';
import { listStores } from '../../services/organizationService.js';
import { listMembers } from '../../services/memberService.js';
import { useHasPermission, useSession } from '../auth/useSession.js';

/**
 * Landing page of the organization. The sales dashboard replaces the top of this page in
 * Phase 5; until then it shows real organization data only.
 */
export function OverviewPage() {
  const { data: session } = useSession();
  const can = useHasPermission();
  const org = session.activeOrganization;
  const stores = useQuery({ queryKey: ['stores'], queryFn: listStores });
  const members = useQuery({
    queryKey: ['members'],
    queryFn: listMembers,
    enabled: can('member:read'),
  });

  return (
    <>
      <PageHeader
        title={org.name}
        description={`You are signed in as ${ROLE_LABELS[org.role].toLowerCase()}.`}
      />
      <div className="grid gap-6 md:grid-cols-2">
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
                <li key={s.id} className="flex items-center justify-between py-2.5 text-sm">
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

        {can('member:read') && (
          <Card
            title="Team"
            actions={
              <Link
                to="/employees"
                className="text-sm font-medium text-indigo-600 hover:text-indigo-500"
              >
                Manage
              </Link>
            }
          >
            {members.isPending ? (
              <SkeletonRows rows={2} label="Loading team" />
            ) : members.isError ? (
              <Alert tone="error">{getApiError(members.error).message}</Alert>
            ) : (
              <dl className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="text-slate-500">Active members</dt>
                  <dd className="mt-1 text-2xl font-semibold text-slate-900">
                    {members.data.filter((m) => m.status === 'ACTIVE').length}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Deactivated</dt>
                  <dd className="mt-1 text-2xl font-semibold text-slate-900">
                    {members.data.filter((m) => m.status !== 'ACTIVE').length}
                  </dd>
                </div>
              </dl>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
