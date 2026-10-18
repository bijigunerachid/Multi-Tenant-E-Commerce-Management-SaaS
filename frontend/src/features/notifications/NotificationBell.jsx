import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellIcon } from '@heroicons/react/24/outline';
import { useDismiss } from '../../hooks/useDismiss.js';
import { getApiError } from '../../lib/apiClient.js';
import {
  getUnreadCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../../services/notificationService.js';
import { describeNotification, timeAgo } from './describe.js';

const PREVIEW_SIZE = 6;
// The unread count is checked every 30 s (and when the window regains focus).
export const UNREAD_POLL_MS = 30_000;

/** Shared by the bell and the notifications page, so marking one updates both. */
export function useNotificationActions(organizationId) {
  const queryClient = useQueryClient();
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['notifications', organizationId] });
  return {
    markRead: useMutation({ mutationFn: (id) => markNotificationRead(id), onSuccess: refresh }),
    markAll: useMutation({ mutationFn: () => markAllNotificationsRead(), onSuccess: refresh }),
  };
}

export function NotificationItem({ notification, onOpen, compact = false }) {
  const { title, body, href } = describeNotification(notification);
  const unread = !notification.readAt;
  return (
    <Link
      to={href}
      onClick={() => onOpen(notification)}
      className={`flex gap-3 px-4 py-3 text-left hover:bg-ink-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600 ${unread ? '' : 'opacity-75'}`}
    >
      <span
        aria-hidden="true"
        className={`mt-1.5 size-2 shrink-0 rounded-full ${unread ? 'bg-brand-600' : 'bg-transparent'}`}
      />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span
            className={`break-words text-sm ${unread ? 'font-semibold text-ink-900' : 'text-ink-700'}`}
          >
            {title}
            {unread && <span className="sr-only">, unread</span>}
          </span>
          <time dateTime={notification.createdAt} className="shrink-0 text-xs text-ink-500">
            {timeAgo(notification.createdAt)}
          </time>
        </span>
        <span className={`block break-words text-sm text-ink-600 ${compact ? 'line-clamp-2' : ''}`}>
          {body}
        </span>
      </span>
    </Link>
  );
}

export function NotificationBell({ organizationId }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, setOpen);
  const navigate = useNavigate();
  const { markRead, markAll } = useNotificationActions(organizationId);

  const unread = useQuery({
    queryKey: ['notifications', organizationId, 'unread-count'],
    queryFn: getUnreadCount,
    refetchInterval: UNREAD_POLL_MS,
  });
  const latest = useQuery({
    queryKey: ['notifications', organizationId, 'list', { pageSize: PREVIEW_SIZE }],
    queryFn: () => listNotifications({ pageSize: PREVIEW_SIZE }),
    enabled: open,
  });
  const count = unread.data ?? 0;

  const openOne = (n) => {
    setOpen(false);
    if (!n.readAt) markRead.mutate(n.id);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-full p-1.5 text-ink-600 hover:bg-ink-100 hover:text-ink-900 focus-visible:outline-2 focus-visible:outline-brand-600"
      >
        <BellIcon aria-hidden="true" className="size-6" />
        <span className="sr-only">
          {count > 0 ? `Notifications, ${count} unread` : 'Notifications'}
        </span>
        {count > 0 && (
          <span
            aria-hidden="true"
            className="absolute -right-0.5 -top-0.5 grid min-w-5 place-items-center rounded-full bg-red-600 px-1 text-[0.6875rem] font-semibold leading-5 text-white"
          >
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 z-30 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-md bg-white shadow-lg ring-1 ring-ink-200"
        >
          <div className="flex items-center justify-between gap-2 border-b border-ink-100 px-4 py-2.5">
            <h2 className="text-sm font-semibold text-ink-900">Notifications</h2>
            {count > 0 && (
              <button
                type="button"
                disabled={markAll.isPending}
                onClick={() => markAll.mutate()}
                className="text-sm font-medium text-brand-600 hover:text-brand-500 disabled:opacity-60"
              >
                Mark all as read
              </button>
            )}
          </div>
          {latest.isPending ? (
            <p className="px-4 py-6 text-center text-sm text-ink-500">Loading…</p>
          ) : latest.isError ? (
            <p role="alert" className="px-4 py-6 text-center text-sm text-red-700">
              {getApiError(latest.error).message}
            </p>
          ) : latest.data.data.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-ink-500">
              You are all caught up. New orders and stock alerts will appear here.
            </p>
          ) : (
            <ul className="max-h-[min(24rem,70vh)] divide-y divide-ink-100 overflow-y-auto">
              {latest.data.data.map((n) => (
                <li key={n.id}>
                  <NotificationItem notification={n} onOpen={openOne} compact />
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              navigate('/notifications');
            }}
            className="block w-full border-t border-ink-100 px-4 py-2.5 text-center text-sm font-medium text-brand-600 hover:bg-ink-50"
          >
            View all notifications
          </button>
        </div>
      )}
    </div>
  );
}
