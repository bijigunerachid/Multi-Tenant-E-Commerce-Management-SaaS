import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellIcon } from '@heroicons/react/24/outline';
import { Alert, Card, EmptyState, PageHeader, SkeletonRows } from '../../components/ui/layout.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Pagination } from '../../components/ui/Pagination.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { getApiError } from '../../lib/apiClient.js';
import {
  getNotificationPreferences,
  listNotifications,
  updateNotificationPreferences,
} from '../../services/notificationService.js';
import { useSession } from '../auth/useSession.js';
import { NotificationItem, useNotificationActions } from './NotificationBell.jsx';
import { TYPE_LABELS } from './describe.js';

const PAGE_SIZE = 20;
const FILTERS = [
  { value: '', label: 'All' },
  { value: 'unread', label: 'Unread' },
];

function EmailPreferences({ organizationId }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const key = ['notifications', organizationId, 'preferences'];
  const preferences = useQuery({ queryKey: key, queryFn: getNotificationPreferences });
  // What was just clicked, shown until the save settles. Kept in component state so the box
  // changes within the click itself; query cache updates reach the screen a tick later, and
  // React would first put a controlled checkbox back to its old value.
  const [pending, setPending] = useState({});
  const save = useMutation({
    mutationFn: (email) => updateNotificationPreferences(email),
    onSuccess: (saved) => {
      queryClient.setQueryData(key, saved);
      toast.success('Email settings saved.');
    },
    onError: (e) => toast.error(getApiError(e).message),
  });
  const toggle = (type, on) => {
    setPending((p) => ({ ...p, [type]: on }));
    save.mutate(
      { [type]: on },
      // On failure the saved value shows again.
      { onSettled: () => setPending(({ [type]: _done, ...rest }) => rest) },
    );
  };

  return (
    <Card
      title="Email me too"
      description="Notifications always appear here. Choose the ones you also want by email."
    >
      {preferences.isPending ? (
        <SkeletonRows rows={2} label="Loading email settings" />
      ) : preferences.isError ? (
        <Alert tone="error">{getApiError(preferences.error).message}</Alert>
      ) : preferences.data.length === 0 ? (
        <p className="text-sm text-ink-600">
          Your role does not receive notifications in this organization.
        </p>
      ) : (
        <fieldset className="min-w-0 space-y-4">
          <legend className="sr-only">Email notifications</legend>
          {preferences.data.map((p) => (
            <label key={p.type} className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={pending[p.type] ?? p.email}
                disabled={save.isPending}
                onChange={(e) => toggle(p.type, e.target.checked)}
                className="mt-0.5 size-4 rounded border-ink-300 text-brand-600 focus:ring-brand-600"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-ink-900">
                  {TYPE_LABELS[p.type]?.label ?? p.type}
                </span>
                <span className="block text-sm text-ink-500">
                  {TYPE_LABELS[p.type]?.description}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
    </Card>
  );
}

export function NotificationsPage() {
  const { data: session } = useSession();
  const organizationId = session.activeOrganization.id;
  const [params, setParams] = useSearchParams();
  const filter = params.get('filter') === 'unread' ? 'unread' : '';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const update = (changes) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next, { replace: true });
  };

  const query = { page, pageSize: PAGE_SIZE, ...(filter ? { unread: 'true' } : {}) };
  const list = useQuery({
    queryKey: ['notifications', organizationId, 'list', query],
    queryFn: () => listNotifications(query),
    placeholderData: keepPreviousData,
  });
  const { markRead, markAll } = useNotificationActions(organizationId);
  const unreadCount = list.data?.meta.unreadCount ?? 0;

  return (
    <>
      <PageHeader
        title="Notifications"
        description="New orders and stock alerts for your role in this organization. Notifications are kept for 90 days."
        actions={
          unreadCount > 0 && (
            <Button
              variant="secondary"
              loading={markAll.isPending}
              onClick={() => markAll.mutate()}
            >
              Mark all as read
            </Button>
          )
        }
      />
      <div className="grid gap-6 lg:grid-cols-3 [&>*]:min-w-0">
        <div className="lg:col-span-2">
          <Card>
            <div role="group" aria-label="Show" className="mb-4 flex gap-2">
              {FILTERS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  aria-pressed={filter === f.value}
                  onClick={() => update({ filter: f.value, page: null })}
                  className={`rounded-full px-3 py-1 text-sm font-medium ${
                    filter === f.value
                      ? 'bg-brand-600 text-white'
                      : 'bg-ink-100 text-ink-700 hover:bg-ink-200'
                  }`}
                >
                  {f.label}
                  {f.value === 'unread' && unreadCount > 0 ? ` (${unreadCount})` : ''}
                </button>
              ))}
            </div>
            {list.isPending ? (
              <SkeletonRows rows={5} label="Loading notifications" />
            ) : list.isError ? (
              <Alert
                tone="error"
                action={
                  <Button size="sm" variant="secondary" onClick={() => list.refetch()}>
                    Retry
                  </Button>
                }
              >
                {getApiError(list.error).message}
              </Alert>
            ) : list.data.data.length === 0 ? (
              <EmptyState
                icon={BellIcon}
                title={filter ? 'No unread notifications' : 'No notifications yet'}
                description="You are notified here when an order is placed or a product runs low, if your role handles it."
              />
            ) : (
              <div className="space-y-4">
                <ul className="-mx-5 divide-y divide-ink-100 border-y border-ink-100">
                  {list.data.data.map((n) => (
                    <li key={n.id}>
                      <NotificationItem
                        notification={n}
                        onOpen={(item) => !item.readAt && markRead.mutate(item.id)}
                      />
                    </li>
                  ))}
                </ul>
                <Pagination
                  page={page}
                  pageSize={PAGE_SIZE}
                  total={list.data.meta.total}
                  onPageChange={(p) => update({ page: String(p) })}
                />
              </div>
            )}
          </Card>
        </div>
        <EmailPreferences organizationId={organizationId} />
      </div>
    </>
  );
}
