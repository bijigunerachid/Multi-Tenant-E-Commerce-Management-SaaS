import { useEffect, useState } from 'react';
import { Link, useNavigation, useSearchParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { BuildingOffice2Icon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
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
import { useDebouncedValue } from '../../hooks/useDebouncedValue.js';
import { getApiError } from '../../lib/apiClient.js';
import { formatDate, formatMoney } from '../../lib/format.js';
import { getPlatformStats, listAllOrganizations } from '../../services/adminService.js';
import { STATUS_LABELS } from '../billing/subscription.js';

const PAGE_SIZE = 25;
const ORG_STATUS = { ACTIVE: 'Active', SUSPENDED: 'Suspended' };
const PLANS = { starter: 'Starter', growth: 'Growth', scale: 'Scale' };

function Tile({ label, value, children }) {
  return (
    <div className="rounded-lg border border-ink-200 bg-white px-5 py-4">
      <dt className="text-sm text-ink-500">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums text-ink-900">{value}</dd>
      {children && <dd className="mt-1 text-xs text-ink-500">{children}</dd>}
    </div>
  );
}

function Stats() {
  const stats = useQuery({ queryKey: ['admin', 'stats'], queryFn: getPlatformStats });
  if (stats.isPending) return <SkeletonRows rows={2} label="Loading platform figures" />;
  if (stats.isError) return <Alert tone="error">{getApiError(stats.error).message}</Alert>;
  const s = stats.data;
  const mrr = s.monthlyRecurringRevenue;
  const byStatus = (status) => s.subscriptionsByStatus[status] ?? 0;
  return (
    <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Tile label="Organizations" value={s.organizations.total}>
        {s.organizations.suspended} suspended · {s.organizations.createdLast30Days} new in 30 days
      </Tile>
      <Tile
        label="Monthly recurring revenue"
        value={mrr.length ? mrr.map((m) => formatMoney(m.amount, m.currency)).join(' + ') : '—'}
      >
        {mrr.reduce((n, m) => n + m.subscriptions, 0)} paying through Stripe
      </Tile>
      <Tile label="Trials" value={byStatus('TRIALING')}>
        {s.trialsEndingIn7Days} ending within 7 days · {byStatus('EXPIRED')} expired
      </Tile>
      <Tile label="Failed webhooks" value={s.failedWebhooks}>
        {s.failedWebhooks ? 'Stripe retries them; check the logs' : 'Nothing to look at'}
      </Tile>
    </dl>
  );
}

export function AdminOverviewPage() {
  const [params, setParams] = useSearchParams();
  const filters = {
    search: params.get('search') ?? '',
    status: ORG_STATUS[params.get('status')] ? params.get('status') : '',
    subscription: STATUS_LABELS[params.get('subscription')] ? params.get('subscription') : '',
    plan: PLANS[params.get('plan')] ? params.get('plan') : '',
    page: Math.max(1, Number(params.get('page')) || 1),
  };
  const update = (changes) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, String(v));
      else next.delete(k);
    }
    setParams(next, { replace: true });
  };
  const [searchInput, setSearchInput] = useState(filters.search);
  const search = useDebouncedValue(searchInput);
  // A click on a result while the search is settling wins: its navigation must not be
  // replaced by the search box updating the URL.
  const navigation = useNavigation();
  useEffect(() => {
    if (navigation.state !== 'idle') return;
    if (search !== filters.search) update({ search, page: null });
    // Only the debounced input drives the URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const query = {
    page: filters.page,
    pageSize: PAGE_SIZE,
    ...(filters.search ? { search: filters.search } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.subscription ? { subscription: filters.subscription } : {}),
    ...(filters.plan ? { plan: filters.plan } : {}),
  };
  const orgs = useQuery({
    queryKey: ['admin', 'organizations', query],
    queryFn: () => listAllOrganizations(query),
    placeholderData: keepPreviousData,
  });
  const filtered = Boolean(
    filters.search || filters.status || filters.subscription || filters.plan,
  );

  const select = (label, value, options, key) => (
    <label className="min-w-0">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => update({ [key]: e.target.value, page: null })}
        className="w-full rounded-md border-0 py-2 pl-3 pr-8 text-sm ring-1 ring-inset ring-ink-300 focus:ring-2 focus:ring-brand-600"
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <>
      <PageHeader
        title="Platform"
        description="Every organization on Vendora. Changes you make here are recorded in the organization's audit log."
      />
      <div className="space-y-6">
        <Stats />
        <Card title="Organizations">
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 [&>*]:min-w-0">
            <label className="relative block">
              <span className="sr-only">Search organizations</span>
              <MagnifyingGlassIcon
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-2.5 size-4 text-ink-400"
              />
              <input
                type="search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Name or email…"
                className="w-full rounded-md border-0 py-2 pl-9 pr-3 text-sm ring-1 ring-inset ring-ink-300 focus:ring-2 focus:ring-brand-600"
              />
            </label>
            {select(
              'Organization status',
              filters.status,
              [['', 'Any status'], ...Object.entries(ORG_STATUS)],
              'status',
            )}
            {select(
              'Subscription',
              filters.subscription,
              [
                ['', 'Any subscription'],
                ...Object.entries(STATUS_LABELS).map(([k, v]) => [k, v.label]),
              ],
              'subscription',
            )}
            {select('Plan', filters.plan, [['', 'Any plan'], ...Object.entries(PLANS)], 'plan')}
          </div>
          {orgs.isPending ? (
            <SkeletonRows rows={5} label="Loading organizations" />
          ) : orgs.isError ? (
            <Alert
              tone="error"
              action={
                <Button size="sm" variant="secondary" onClick={() => orgs.refetch()}>
                  Retry
                </Button>
              }
            >
              {getApiError(orgs.error).message}
            </Alert>
          ) : orgs.data.data.length === 0 ? (
            <EmptyState
              icon={BuildingOffice2Icon}
              title={filtered ? 'No organization matches' : 'No organizations yet'}
              description={filtered ? 'Try another search or filter.' : undefined}
            />
          ) : (
            <div className="space-y-4">
              <ul className="-mx-5 divide-y divide-ink-100 border-y border-ink-100">
                {orgs.data.data.map((o) => {
                  const sub = STATUS_LABELS[o.subscriptionStatus];
                  return (
                    <li key={o.id}>
                      <Link
                        to={`/admin/organizations/${o.id}`}
                        className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-3 text-sm hover:bg-ink-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600"
                      >
                        <span className="min-w-0">
                          <span className="block break-words font-medium text-ink-900">
                            {o.name}
                          </span>
                          <span className="block break-all text-xs text-ink-500">
                            {o.owner?.email ?? 'No active owner'} · {o.memberCount}{' '}
                            {o.memberCount === 1 ? 'member' : 'members'} · since{' '}
                            {formatDate(o.createdAt)}
                          </span>
                        </span>
                        <span className="flex flex-wrap items-center gap-2">
                          {o.status === 'SUSPENDED' && <Badge tone="danger">Suspended</Badge>}
                          {o.planName && <span className="text-ink-600">{o.planName}</span>}
                          {sub && <Badge tone={sub.tone}>{sub.label}</Badge>}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
              <Pagination
                page={filters.page}
                pageSize={PAGE_SIZE}
                total={orgs.data.meta.total}
                onPageChange={(p) => update({ page: p })}
              />
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
