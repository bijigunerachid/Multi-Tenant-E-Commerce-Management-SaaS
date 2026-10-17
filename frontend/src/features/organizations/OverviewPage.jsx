import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Alert, Card, PageHeader, SkeletonRows } from '../../components/ui/layout.jsx';
import { getApiError } from '../../lib/apiClient.js';
import { ROLE_LABELS } from '../../lib/roles.js';
import { listMembers } from '../../services/memberService.js';
import { useHasPermission, useSession } from '../auth/useSession.js';
import { StoresCard } from './StoresCard.jsx';

/** Home page for roles without report access (the dashboard replaces it for the others). */
export function OverviewPage() {
  const { data: session } = useSession();
  const can = useHasPermission();
  const org = session.activeOrganization;
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
      <div className="grid gap-6 md:grid-cols-2 [&>*]:min-w-0">
        <StoresCard />

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
