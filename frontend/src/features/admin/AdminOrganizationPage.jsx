import { useId, useState } from 'react';
import { useParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Badge, Card, PageHeader, SkeletonRows } from '../../components/ui/layout.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Dialog } from '../../components/ui/Dialog.jsx';
import { SelectField, TextField } from '../../components/ui/fields.jsx';
import { Pagination } from '../../components/ui/Pagination.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useServerErrors } from '../../hooks/useServerErrors.js';
import { getApiError } from '../../lib/apiClient.js';
import { formatDate } from '../../lib/format.js';
import { ROLE_LABELS } from '../../lib/roles.js';
import {
  changeOrganizationSubscription,
  getAdminOrganization,
  getOrganizationAuditLogs,
  reactivateOrganization,
  suspendOrganization,
} from '../../services/adminService.js';
import { RESOURCE_LABELS, STATUS_LABELS } from '../billing/subscription.js';

const reasonField = z
  .string()
  .trim()
  .min(5, 'Give a reason (at least 5 characters)')
  .max(500, 'Use at most 500 characters');
const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function ReasonField({ register, error, label = 'Reason', hint }) {
  // Several reason fields can be on the page at once (a dialog over the audit log card).
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-ink-800">
        {label}
      </label>
      <textarea
        id={id}
        rows={3}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : `${id}-hint`}
        className="mt-1.5 block w-full rounded-md border-0 px-3 py-2 text-sm ring-1 ring-inset ring-ink-300 focus:ring-2 focus:ring-inset focus:ring-brand-600"
        {...register('reason')}
      />
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 text-sm text-red-600">
          {error}
        </p>
      ) : (
        <p id={`${id}-hint`} className="mt-1.5 text-sm text-ink-500">
          {hint ?? "Recorded in the organization's audit log, which its owner can read."}
        </p>
      )}
    </div>
  );
}

/** Suspend or reactivate, with a reason. */
function StatusDialog({ organization, open, onClose }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const suspending = organization.status === 'ACTIVE';
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors },
  } = useForm({ resolver: zodResolver(z.object({ reason: reasonField })) });
  const [formError, handleError] = useServerErrors(setError);
  const save = useMutation({
    mutationFn: ({ reason }) =>
      suspending
        ? suspendOrganization(organization.id, reason)
        : reactivateOrganization(organization.id, reason),
    onSuccess: (updated) => {
      queryClient.setQueryData(['admin', 'organization', organization.id], updated);
      queryClient.invalidateQueries({ queryKey: ['admin', 'organizations'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'stats'] });
      toast.success(
        suspending ? `${organization.name} suspended.` : `${organization.name} reactivated.`,
      );
      reset();
      onClose();
    },
    onError: handleError,
  });
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={suspending ? `Suspend ${organization.name}?` : `Reactivate ${organization.name}?`}
      description={
        suspending
          ? 'Its members lose access at once: every request is refused until it is reactivated. Nothing is deleted.'
          : 'Its members get their access back at once.'
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="status-form"
            variant={suspending ? 'danger' : 'primary'}
            loading={save.isPending}
          >
            {suspending ? 'Suspend organization' : 'Reactivate organization'}
          </Button>
        </>
      }
    >
      <form
        id="status-form"
        noValidate
        onSubmit={handleSubmit((v) => save.mutate(v))}
        className="space-y-4"
      >
        {formError && <Alert tone="error">{formError}</Alert>}
        {suspending && organization.subscription?.billedByProvider && (
          <Alert tone="warning">
            Stripe keeps billing this organization while it is suspended. Cancel or pause its
            subscription in the Stripe Dashboard if it should not be charged.
          </Alert>
        )}
        <ReasonField register={register} error={errors.reason?.message} />
      </form>
    </Dialog>
  );
}

const subscriptionSchema = z
  .object({
    plan: z.string().min(1),
    status: z.enum(['TRIALING', 'ACTIVE', 'CANCELED']),
    trialEndsOn: z.string().optional(),
    reason: reasonField,
  })
  .superRefine((v, ctx) => {
    if (v.status === 'TRIALING' && !v.trialEndsOn) {
      ctx.addIssue({
        code: 'custom',
        path: ['trialEndsOn'],
        message: 'Choose the last day of the trial',
      });
    }
  });

const SUBSCRIPTION_CHOICES = [
  { value: 'TRIALING', label: 'Trial until a date' },
  { value: 'ACTIVE', label: 'Active, free of charge' },
  { value: 'CANCELED', label: 'Canceled (read-only)' },
];
const PLAN_OPTIONS = [
  { value: 'starter', label: 'Starter' },
  { value: 'growth', label: 'Growth' },
  { value: 'scale', label: 'Scale' },
];

function SubscriptionDialog({ organization, open, onClose }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const current = organization.subscription;
  const {
    register,
    handleSubmit,
    setError,
    watch,
    reset,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(subscriptionSchema),
    values: {
      plan: current?.plan.code ?? 'growth',
      status: 'TRIALING',
      trialEndsOn: '',
      reason: '',
    },
  });
  const [formError, handleError] = useServerErrors((field, error) =>
    setError(field === 'trialEndsAt' ? 'trialEndsOn' : field, error),
  );
  const save = useMutation({
    mutationFn: ({ plan, status, trialEndsOn, reason }) =>
      changeOrganizationSubscription(organization.id, {
        plan,
        status,
        reason,
        // The trial runs to the end of the chosen day, in the admin's time zone.
        ...(status === 'TRIALING'
          ? { trialEndsAt: new Date(`${trialEndsOn}T23:59:59`).toISOString() }
          : {}),
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['admin', 'organization', organization.id], updated);
      queryClient.invalidateQueries({ queryKey: ['admin', 'organizations'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'stats'] });
      toast.success('Subscription changed.');
      reset();
      onClose();
    },
    onError: handleError,
  });
  const status = watch('status');
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Change subscription"
      description="For organizations that do not pay through Stripe: extend a trial, give a plan free of charge, or end access."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="subscription-form" loading={save.isPending}>
            Save
          </Button>
        </>
      }
    >
      <form
        id="subscription-form"
        noValidate
        onSubmit={handleSubmit((v) => save.mutate(v))}
        className="space-y-4"
      >
        {formError && <Alert tone="error">{formError}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="Plan"
            options={PLAN_OPTIONS}
            error={errors.plan?.message}
            {...register('plan')}
          />
          <SelectField
            label="Status"
            options={SUBSCRIPTION_CHOICES}
            error={errors.status?.message}
            {...register('status')}
          />
        </div>
        {status === 'TRIALING' && (
          <TextField
            type="date"
            label="Last day of the trial"
            hint="At most 90 days from today."
            error={errors.trialEndsOn?.message}
            {...register('trialEndsOn')}
          />
        )}
        <ReasonField register={register} error={errors.reason?.message} />
      </form>
    </Dialog>
  );
}

/** The organization's audit log. Loading it records who looked and why. */
function AuditLogCard({ organizationId }) {
  const [reason, setReason] = useState(null);
  const [page, setPage] = useState(1);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({ resolver: zodResolver(z.object({ reason: reasonField })) });
  const logs = useQuery({
    queryKey: ['admin', 'organization', organizationId, 'audit', reason, page],
    queryFn: () => getOrganizationAuditLogs(organizationId, { reason, page, pageSize: 20 }),
    enabled: Boolean(reason),
    placeholderData: keepPreviousData,
  });
  return (
    <Card
      title="Audit log"
      description="Opening it is recorded in the same log, with your reason, and the owner can see that."
    >
      {!reason ? (
        <form noValidate onSubmit={handleSubmit((v) => setReason(v.reason))} className="space-y-4">
          <ReasonField
            register={register}
            error={errors.reason?.message}
            label="Why do you need to read it?"
            hint="For example the support ticket you are working on."
          />
          <Button type="submit" variant="secondary">
            Show audit log
          </Button>
        </form>
      ) : logs.isPending ? (
        <SkeletonRows rows={5} label="Loading audit log" />
      ) : logs.isError ? (
        <Alert tone="error">{getApiError(logs.error).message}</Alert>
      ) : (
        <div className="space-y-4">
          <ul className="-mx-5 divide-y divide-ink-100 border-y border-ink-100">
            {logs.data.data.map((r) => (
              <li key={r.id} className="px-5 py-2.5 text-sm">
                <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <code className="break-all text-xs font-medium text-ink-900">{r.action}</code>
                  <time className="text-xs text-ink-500" dateTime={r.createdAt}>
                    {dateTime.format(new Date(r.createdAt))}
                  </time>
                </span>
                <span className="block break-words text-xs text-ink-500">
                  {r.actor ? (r.actor.email ?? r.actor.id) : 'System'}
                  {r.metadata?.reason ? ` · ${r.metadata.reason}` : ''}
                </span>
              </li>
            ))}
          </ul>
          <Pagination
            page={page}
            pageSize={20}
            total={logs.data.meta.total}
            onPageChange={setPage}
          />
        </div>
      )}
    </Card>
  );
}

export function AdminOrganizationPage() {
  const { organizationId } = useParams();
  const [dialog, setDialog] = useState(null); // 'status' | 'subscription'
  const org = useQuery({
    queryKey: ['admin', 'organization', organizationId],
    queryFn: () => getAdminOrganization(organizationId),
  });

  if (org.isPending) return <SkeletonRows rows={6} label="Loading organization" />;
  if (org.isError) return <Alert tone="error">{getApiError(org.error).message}</Alert>;
  const o = org.data;
  const sub = o.subscription;
  const subLabel = sub ? STATUS_LABELS[sub.status] : null;

  return (
    <>
      <PageHeader
        title={o.name}
        description={`${o.slug} · created ${formatDate(o.createdAt)}`}
        actions={
          <Button
            variant={o.status === 'ACTIVE' ? 'danger' : 'primary'}
            onClick={() => setDialog('status')}
          >
            {o.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}
          </Button>
        }
      />
      <div className="space-y-6">
        {o.status === 'SUSPENDED' && (
          <Alert tone="error" title={`Suspended on ${formatDate(o.suspendedAt)}`}>
            {o.suspendedReason}
          </Alert>
        )}
        <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
          <Card
            title="Subscription"
            actions={
              !sub?.billedByProvider && (
                <Button size="sm" variant="secondary" onClick={() => setDialog('subscription')}>
                  Change
                </Button>
              )
            }
          >
            {sub ? (
              <dl className="space-y-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <dt className="sr-only">Plan</dt>
                  <dd className="text-base font-semibold text-ink-900">{sub.plan.name}</dd>
                  <dt className="sr-only">Status</dt>
                  <dd>
                    <Badge tone={subLabel.tone}>{subLabel.label}</Badge>
                  </dd>
                </div>
                {sub.trialEndsAt && (
                  <div className="text-ink-600">
                    <dt className="inline">Trial ends: </dt>
                    <dd className="inline">{formatDate(sub.trialEndsAt)}</dd>
                  </div>
                )}
                <div className="text-ink-600">
                  <dt className="inline">Billing: </dt>
                  <dd className="inline">
                    {sub.billedByProvider
                      ? `Stripe (${sub.providerCustomerId}). Change it in the Stripe Dashboard.`
                      : sub.status === 'ACTIVE'
                        ? 'Free of charge (set by an admin)'
                        : 'Not paying'}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-ink-600">No subscription.</p>
            )}
          </Card>
          <Card title="Usage">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              {[...Object.entries(RESOURCE_LABELS), ['orders', 'Orders placed']].map(
                ([key, label]) => (
                  <div key={key}>
                    <dt className="text-ink-500">{label}</dt>
                    <dd className="text-lg font-semibold tabular-nums text-ink-900">
                      {o.usage[key].toLocaleString()}
                    </dd>
                  </div>
                ),
              )}
            </dl>
            {o.failedWebhooks > 0 && (
              <p className="mt-3 text-sm text-red-700">
                {o.failedWebhooks} Stripe {o.failedWebhooks === 1 ? 'event' : 'events'} failed to
                apply for this organization.
              </p>
            )}
          </Card>
        </div>
        <Card title="Members">
          {/* Edge to edge inside the card, without the card's own padding around the list. */}
          <ul className="-mx-5 -my-4 divide-y divide-ink-100">
            {o.members.map((m) => (
              <li
                key={m.id}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-2.5 text-sm"
              >
                <span className="min-w-0">
                  <span className="block break-words font-medium text-ink-900">{m.name}</span>
                  <span className="block break-all text-xs text-ink-500">{m.email}</span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-ink-600">{ROLE_LABELS[m.role]}</span>
                  {m.status !== 'ACTIVE' && <Badge>Deactivated</Badge>}
                  {m.userStatus !== 'ACTIVE' && <Badge tone="danger">Account disabled</Badge>}
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <AuditLogCard organizationId={o.id} />
      </div>
      <StatusDialog organization={o} open={dialog === 'status'} onClose={() => setDialog(null)} />
      {!sub?.billedByProvider && (
        <SubscriptionDialog
          organization={o}
          open={dialog === 'subscription'}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}
