import { useEffect, useState } from 'react';
import { Link, useNavigation, useSearchParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { MagnifyingGlassIcon, UsersIcon } from '@heroicons/react/24/outline';
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
import { formatDate } from '../../lib/format.js';
import { listUsers } from '../../services/adminService.js';

const PAGE_SIZE = 25;
const STATUSES = { '': 'Any status', ACTIVE: 'Active', DISABLED: 'Disabled' };

/** Badges for what matters at a glance: disabled, unconfirmed, admin, two-factor. */
export function UserBadges({ user }) {
  return (
    <>
      {user.status === 'DISABLED' && <Badge tone="danger">Disabled</Badge>}
      {!user.emailVerified && <Badge tone="warning">Email not confirmed</Badge>}
      {user.platformRole === 'SUPER_ADMIN' && <Badge tone="accent">Platform admin</Badge>}
      {user.mfaEnabled && <Badge tone="success">Two-factor</Badge>}
    </>
  );
}

export function AdminUsersPage() {
  const [params, setParams] = useSearchParams();
  const search = params.get('search') ?? '';
  const status = STATUSES[params.get('status')] ? params.get('status') : '';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const update = (changes) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, String(v));
      else next.delete(k);
    }
    setParams(next, { replace: true });
  };
  const [input, setInput] = useState(search);
  const debounced = useDebouncedValue(input);
  // A click on a result while the search is settling wins: its navigation must not be
  // replaced by the search box updating the URL.
  const navigation = useNavigation();
  useEffect(() => {
    if (navigation.state !== 'idle') return;
    if (debounced !== search) update({ search: debounced, page: null });
    // Only the debounced input drives the URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const query = {
    page,
    pageSize: PAGE_SIZE,
    ...(search ? { search } : {}),
    ...(status ? { status } : {}),
  };
  const users = useQuery({
    queryKey: ['admin', 'users', query],
    queryFn: () => listUsers(query),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader
        title="Users"
        description="Every account on Vendora, whatever organizations it belongs to."
      />
      <Card>
        <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_12rem] [&>*]:min-w-0">
          <label className="relative block">
            <span className="sr-only">Search users</span>
            <MagnifyingGlassIcon
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-2.5 size-4 text-ink-400"
            />
            <input
              type="search"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Name or email…"
              spellCheck={false}
              className="w-full rounded-md border-0 py-2 pl-9 pr-3 text-sm ring-1 ring-inset ring-ink-300 focus:ring-2 focus:ring-brand-600"
            />
          </label>
          <label>
            <span className="sr-only">Account status</span>
            <select
              value={status}
              onChange={(e) => update({ status: e.target.value, page: null })}
              className="w-full rounded-md border-0 py-2 pl-3 pr-8 text-sm ring-1 ring-inset ring-ink-300 focus:ring-2 focus:ring-brand-600"
            >
              {Object.entries(STATUSES).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        </div>
        {users.isPending ? (
          <SkeletonRows rows={5} label="Loading users" />
        ) : users.isError ? (
          <Alert
            tone="error"
            action={
              <Button size="sm" variant="secondary" onClick={() => users.refetch()}>
                Retry
              </Button>
            }
          >
            {getApiError(users.error).message}
          </Alert>
        ) : users.data.data.length === 0 ? (
          <EmptyState
            icon={UsersIcon}
            title={search || status ? 'No user matches' : 'No users yet'}
          />
        ) : (
          <div className="space-y-4">
            <ul className="-mx-5 divide-y divide-ink-100 border-y border-ink-100">
              {users.data.data.map((u) => (
                <li key={u.id}>
                  <Link
                    to={`/admin/users/${u.id}`}
                    className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-3 text-sm hover:bg-ink-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600"
                  >
                    <span className="min-w-0">
                      <span className="block break-words font-medium text-ink-900">{u.name}</span>
                      <span className="block break-all text-xs text-ink-500">
                        {u.email} · {u.organizations}{' '}
                        {u.organizations === 1 ? 'organization' : 'organizations'} · last sign-in{' '}
                        {u.lastSignInAt ? formatDate(u.lastSignInAt) : 'never'}
                      </span>
                    </span>
                    <span className="flex flex-wrap items-center gap-2">
                      <UserBadges user={u} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={users.data.meta.total}
              onPageChange={(p) => update({ page: p })}
            />
          </div>
        )}
      </Card>
    </>
  );
}
