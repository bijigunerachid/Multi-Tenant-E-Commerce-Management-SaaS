import { Link, useSearchParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ClipboardDocumentListIcon } from '@heroicons/react/24/outline';
import { Alert, Card, EmptyState, PageHeader, SkeletonRows } from '../../components/ui/layout.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Pagination } from '../../components/ui/Pagination.jsx';
import { getApiError } from '../../lib/apiClient.js';
import { listPlatformActivity } from '../../services/adminService.js';

const PAGE_SIZE = 30;
// What each recorded admin action means, in words.
export const ACTIONS = {
  'admin.organization_suspended': 'Suspended an organization',
  'admin.organization_reactivated': 'Reactivated an organization',
  'admin.subscription_changed': 'Changed a subscription',
  'admin.audit_viewed': 'Read an organization’s audit log',
  'admin.user_disabled': 'Disabled an account',
  'admin.user_enabled': 'Enabled an account',
  'admin.user_signed_out': 'Signed a user out everywhere',
  'admin.verification_resent': 'Resent a confirmation email',
  'admin.user_mfa_reset': 'Reset two-factor sign-in',
  'platform.admin_granted': 'Platform admin role granted (server)',
  'platform.admin_revoked': 'Platform admin role revoked (server)',
  'platform.mfa_reset': 'Two-factor sign-in reset (server)',
};
const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function AdminActivityPage() {
  const [params, setParams] = useSearchParams();
  const action = ACTIONS[params.get('action')] ? params.get('action') : '';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const update = (changes) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, String(v));
      else next.delete(k);
    }
    setParams(next, { replace: true });
  };
  const query = { page, pageSize: PAGE_SIZE, ...(action ? { action } : {}) };
  const activity = useQuery({
    queryKey: ['admin', 'activity', query],
    queryFn: () => listPlatformActivity(query),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader
        title="Activity"
        description="Everything platform administrators did, with their reasons. Entries cannot be edited or deleted."
      />
      <Card>
        <label className="mb-4 block max-w-xs">
          <span className="sr-only">Action</span>
          <select
            value={action}
            onChange={(e) => update({ action: e.target.value, page: null })}
            className="w-full rounded-md border-0 py-2 pl-3 pr-8 text-sm ring-1 ring-inset ring-ink-300 focus:ring-2 focus:ring-brand-600"
          >
            <option value="">All actions</option>
            {Object.entries(ACTIONS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        {activity.isPending ? (
          <SkeletonRows rows={6} label="Loading activity" />
        ) : activity.isError ? (
          <Alert
            tone="error"
            action={
              <Button size="sm" variant="secondary" onClick={() => activity.refetch()}>
                Retry
              </Button>
            }
          >
            {getApiError(activity.error).message}
          </Alert>
        ) : activity.data.data.length === 0 ? (
          <EmptyState icon={ClipboardDocumentListIcon} title="Nothing recorded yet" />
        ) : (
          <div className="space-y-4">
            <ol className="-mx-5 divide-y divide-ink-100 border-y border-ink-100">
              {activity.data.data.map((r) => (
                <li key={r.id} className="px-5 py-3 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                    <p className="font-medium text-ink-900">{ACTIONS[r.action] ?? r.action}</p>
                    <time dateTime={r.createdAt} className="text-xs tabular-nums text-ink-500">
                      {dateTime.format(new Date(r.createdAt))}
                    </time>
                  </div>
                  <p className="mt-0.5 break-words text-ink-600">
                    {r.actor ? (r.actor.email ?? 'Unknown admin') : 'Server command line'}
                    {r.organization && (
                      <>
                        {' on '}
                        <Link
                          to={`/admin/organizations/${r.organization.id}`}
                          className="font-medium text-brand-600 hover:text-brand-500"
                        >
                          {r.organization.name}
                        </Link>
                      </>
                    )}
                    {r.user && (
                      <>
                        {r.action.startsWith('platform.') ? ' for ' : ' on '}
                        <Link
                          to={`/admin/users/${r.user.id}`}
                          className="font-medium text-brand-600 hover:text-brand-500"
                        >
                          {r.user.email}
                        </Link>
                      </>
                    )}
                  </p>
                  {r.reason && <p className="mt-1 break-words text-ink-500">“{r.reason}”</p>}
                </li>
              ))}
            </ol>
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={activity.data.meta.total}
              onPageChange={(p) => update({ page: p })}
            />
          </div>
        )}
      </Card>
    </>
  );
}
