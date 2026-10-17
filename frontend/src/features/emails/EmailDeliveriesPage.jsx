import { useSearchParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { EnvelopeIcon } from '@heroicons/react/24/outline';
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
import { getApiError } from '../../lib/apiClient.js';
import { listEmailDeliveries } from '../../services/emailService.js';

const PAGE_SIZE = 25;
const KINDS = {
  'member.invitation': 'Team invitation',
  'organization.ownership_transfer': 'Ownership transfer',
  'notification.order_placed': 'New order notification',
  'notification.low_stock': 'Low stock notification',
};
const STATUS_FILTERS = { '': 'All emails', QUEUED: 'Pending', SENT: 'Sent', FAILED: 'Failed' };
const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function Status({ delivery: d }) {
  if (d.status === 'SENT') return <Badge tone="success">Sent</Badge>;
  if (d.status === 'FAILED') return <Badge tone="danger">Failed</Badge>;
  // Still queued: either waiting for its first attempt or waiting to retry.
  return d.attempts > 0 ? (
    <Badge tone="warning">Retrying</Badge>
  ) : (
    <Badge tone="neutral">Sending</Badge>
  );
}

function Outcome({ delivery: d }) {
  if (d.status === 'SENT') {
    return (
      <>
        Delivered {dateTime.format(new Date(d.sentAt))}
        {d.attempts > 1 && ` after ${d.attempts} attempts`}
      </>
    );
  }
  if (!d.lastError) return 'Waiting to be sent';
  const tries = `${d.attempts} ${d.attempts === 1 ? 'attempt' : 'attempts'}`;
  return (
    <>
      {d.status === 'FAILED' ? `Gave up after ${tries}` : `Failed ${tries}, will retry`}
      <span className="block break-words text-xs text-slate-500">{d.lastError}</span>
    </>
  );
}

export function EmailDeliveriesPage() {
  const [params, setParams] = useSearchParams();
  const status = STATUS_FILTERS[params.get('status')] ? params.get('status') : '';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const update = (changes) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next, { replace: true });
  };

  const query = { page, pageSize: PAGE_SIZE, ...(status ? { status } : {}) };
  const deliveries = useQuery({
    queryKey: ['email-deliveries', query],
    queryFn: () => listEmailDeliveries(query),
    placeholderData: keepPreviousData,
    // Follow pending emails until they are sent or fail.
    refetchInterval: (q) => (q.state.data?.data.some((d) => d.status === 'QUEUED') ? 5_000 : false),
  });

  return (
    <>
      <PageHeader
        title="Email log"
        description="Invitations, ownership transfers and notification emails sent from this organization. Failed emails are retried 5 times before giving up."
      />
      <Card>
        <div className="mb-4">
          <label>
            <span className="sr-only">Status</span>
            <select
              value={status}
              onChange={(e) => update({ status: e.target.value, page: null })}
              className="rounded-md border-0 py-2 pl-3 pr-8 text-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-600"
            >
              {Object.entries(STATUS_FILTERS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {deliveries.isPending ? (
          <SkeletonRows rows={5} label="Loading emails" />
        ) : deliveries.isError ? (
          <Alert
            tone="error"
            action={
              <Button size="sm" variant="secondary" onClick={() => deliveries.refetch()}>
                Retry
              </Button>
            }
          >
            {getApiError(deliveries.error).message}
          </Alert>
        ) : deliveries.data.data.length === 0 ? (
          <EmptyState
            icon={EnvelopeIcon}
            title={status ? 'No emails with this status' : 'No emails sent yet'}
            description="Emails appear here when you invite someone, transfer ownership, or a member turns on notification emails."
          />
        ) : (
          <div className="space-y-4">
            <ul className="-mx-5 divide-y divide-slate-100 border-y border-slate-100">
              {deliveries.data.data.map((d) => (
                <li key={d.id} className="flex flex-wrap items-start gap-x-4 gap-y-2 px-5 py-3">
                  <div className="min-w-0 flex-1 basis-60">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-900">
                      <span className="break-all">{d.to}</span>
                      <Status delivery={d} />
                    </p>
                    <p className="text-xs text-slate-500">
                      {KINDS[d.kind] ?? d.kind} · queued {dateTime.format(new Date(d.createdAt))}
                    </p>
                  </div>
                  <div className="min-w-0 flex-1 basis-60 text-sm text-slate-700">
                    <Outcome delivery={d} />
                  </div>
                </li>
              ))}
            </ul>
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={deliveries.data.meta.total}
              onPageChange={(p) => update({ page: String(p) })}
            />
          </div>
        )}
      </Card>
    </>
  );
}
