import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { CheckIcon, MinusIcon } from '@heroicons/react/20/solid';
import { Alert, Badge, Card, PageHeader, SkeletonRows } from '../../components/ui/layout.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Pagination } from '../../components/ui/Pagination.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { goToExternal } from '../../lib/navigation.js';
import { getApiError } from '../../lib/apiClient.js';
import { formatDate, formatMoney } from '../../lib/format.js';
import {
  getSubscription,
  listInvoices,
  listPlans,
  openBillingPortal,
  startCheckout,
} from '../../services/billingService.js';
import { useSession } from '../auth/useSession.js';
import {
  FEATURE_LABELS,
  RESOURCE_LABELS,
  STATUS_LABELS,
  countOf,
  daysLeft,
} from './subscription.js';

function Meter({ label, used, limit }) {
  const ratio = limit > 0 ? Math.min(1, used / limit) : 1;
  const full = used >= limit;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium text-ink-800">{label}</span>
        <span className={full ? 'font-medium text-red-700' : 'text-ink-600'}>
          {used.toLocaleString()} of {limit.toLocaleString()}
          {full && <span className="sr-only">, limit reached</span>}
        </span>
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={Math.min(used, limit)}
        className="mt-1.5 h-2 overflow-hidden rounded-full bg-ink-100"
      >
        <div
          className={`h-full rounded-full ${full ? 'bg-red-600' : ratio >= 0.8 ? 'bg-amber-500' : 'bg-brand-600'}`}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
    </div>
  );
}

function StatusLine({ subscription: s }) {
  if (s.status === 'TRIALING') {
    const days = daysLeft(s.trialEndsAt);
    return (
      <>
        Your trial ends on {formatDate(s.trialEndsAt)} ({days} {days === 1 ? 'day' : 'days'} left).
        After that the organization becomes read-only until a plan is chosen.
      </>
    );
  }
  if (s.status === 'EXPIRED') {
    return <>The trial ended on {formatDate(s.trialEndsAt)}. The organization is read-only.</>;
  }
  if (s.status === 'CANCELED')
    return <>The subscription is canceled. The organization is read-only.</>;
  if (s.status === 'PAST_DUE') {
    return <>The last payment failed. Everything keeps working while it is retried.</>;
  }
  return s.currentPeriodEnd ? (
    <>
      {s.cancelAtPeriodEnd ? 'Ends' : 'Renews'} on {formatDate(s.currentPeriodEnd)}.
    </>
  ) : null;
}

function PlanCard({ plan, current, action }) {
  return (
    <li
      className={`flex flex-col rounded-lg p-4 ring-1 ${current ? 'bg-brand-50/60 ring-2 ring-brand-600' : 'ring-ink-200'}`}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink-900">{plan.name}</h3>
        {current && <Badge tone="accent">Current plan</Badge>}
      </div>
      <p className="mt-2 text-2xl font-semibold text-ink-900">
        {formatMoney(plan.priceMonthly, plan.currency)}
        <span className="text-sm font-normal text-ink-500"> / month</span>
      </p>
      <ul className="mt-3 space-y-1.5 text-sm text-ink-700">
        {Object.keys(RESOURCE_LABELS).map((key) => (
          <li key={key}>{countOf(key, plan.limits[key])}</li>
        ))}
        {Object.entries(FEATURE_LABELS).map(([key, label]) => (
          <li key={key} className="flex items-center gap-1.5">
            {plan.features[key] ? (
              <CheckIcon aria-hidden="true" className="size-4 text-emerald-600" />
            ) : (
              <MinusIcon aria-hidden="true" className="size-4 text-ink-400" />
            )}
            <span className={plan.features[key] ? '' : 'text-ink-500'}>
              {label}
              <span className="sr-only">
                {plan.features[key] ? ': included' : ': not included'}
              </span>
            </span>
          </li>
        ))}
      </ul>
      {action && <div className="mt-auto pt-4">{action}</div>}
    </li>
  );
}

const INVOICE_STATUS = {
  paid: { label: 'Paid', tone: 'success' },
  open: { label: 'Due', tone: 'warning' },
  uncollectible: { label: 'Unpaid', tone: 'danger' },
  void: { label: 'Void', tone: 'neutral' },
  draft: { label: 'Draft', tone: 'neutral' },
};
const INVOICE_PAGE_SIZE = 12;

function InvoicesCard({ organizationId }) {
  const [page, setPage] = useState(1);
  const query = { page, pageSize: INVOICE_PAGE_SIZE };
  const invoices = useQuery({
    queryKey: ['subscription', organizationId, 'invoices', query],
    queryFn: () => listInvoices(query),
    placeholderData: keepPreviousData,
  });
  return (
    <Card title="Invoices" description="Invoices from Vendora for your plan.">
      {invoices.isPending ? (
        <SkeletonRows rows={2} label="Loading invoices" />
      ) : invoices.isError ? (
        <Alert tone="error">{getApiError(invoices.error).message}</Alert>
      ) : invoices.data.data.length === 0 ? (
        <p className="text-sm text-ink-600">No invoices yet.</p>
      ) : (
        <div className="space-y-4">
          <ul className="-mx-5 divide-y divide-ink-100 border-y border-ink-100">
            {invoices.data.data.map((inv) => {
              const status = INVOICE_STATUS[inv.status] ?? { label: inv.status, tone: 'neutral' };
              return (
                <li
                  key={inv.id}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-3 text-sm"
                >
                  <span className="min-w-0">
                    <span className="block font-medium text-ink-900">
                      {formatDate(inv.issuedAt)}
                      {inv.number && (
                        <span className="font-normal text-ink-500"> · {inv.number}</span>
                      )}
                    </span>
                    {inv.periodStart && (
                      <span className="block text-xs text-ink-500">
                        {formatDate(inv.periodStart)} – {formatDate(inv.periodEnd)}
                      </span>
                    )}
                  </span>
                  <span className="flex flex-wrap items-center gap-3">
                    <span className="font-medium text-ink-900">
                      {formatMoney(inv.amountDue, inv.currency)}
                    </span>
                    <Badge tone={status.tone}>{status.label}</Badge>
                    {inv.hostedInvoiceUrl && (
                      <a
                        href={inv.hostedInvoiceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        // A hidden text span loses its leading space in the accessible name.
                        aria-label={`View invoice ${inv.number ?? formatDate(inv.issuedAt)}`}
                        className="font-medium text-brand-600 hover:text-brand-500"
                      >
                        View
                      </a>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
          <Pagination
            page={page}
            pageSize={INVOICE_PAGE_SIZE}
            total={invoices.data.meta.total}
            onPageChange={setPage}
          />
        </div>
      )}
    </Card>
  );
}

// After Checkout, Stripe's webhook may arrive a moment after the browser: the page checks
// every 2 s for up to a minute. The redirect itself proves nothing and changes nothing.
const CONFIRM_POLL_MS = 2_000;
const CONFIRM_TIMEOUT_MS = 60_000;

function DismissButton({ onClick }) {
  return (
    <Button size="sm" variant="ghost" onClick={onClick}>
      Dismiss
    </Button>
  );
}

function CheckoutResult({ result, confirmed, onDismiss }) {
  if (result === 'canceled') {
    return (
      <Alert tone="info" action={<DismissButton onClick={onDismiss} />}>
        Checkout was canceled. Nothing was charged.
      </Alert>
    );
  }
  if (result !== 'success') return null;
  return confirmed ? (
    <Alert tone="success" action={<DismissButton onClick={onDismiss} />}>
      Your plan is active. Thank you!
    </Alert>
  ) : (
    <Alert tone="info">
      Stripe received your payment details. Your plan updates here as soon as Stripe confirms the
      subscription, usually within a few seconds.
    </Alert>
  );
}

function plansDescription(sub) {
  const prices = 'Prices are in US dollars, per month.';
  if (!sub) return prices;
  if (!sub.billingEnabled) return `${prices} Online payment is not set up on this server yet.`;
  if (sub.billedByProvider) {
    return `${prices} Change plan, update the card or cancel from "Manage billing".`;
  }
  if (sub.status === 'TRIALING') {
    return `${prices} Choosing a plan now keeps the rest of your trial: the first payment is due when it ends.`;
  }
  return prices;
}

export function BillingPage() {
  const { data: session } = useSession();
  const organizationId = session.activeOrganization.id;
  const canManage = session.activeOrganization.permissions.includes('billing:manage');
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const checkoutResult = params.get('checkout');
  const [waitingSince] = useState(() => Date.now());

  const subscription = useQuery({
    queryKey: ['subscription', organizationId],
    queryFn: getSubscription,
    refetchInterval: (q) =>
      checkoutResult === 'success' &&
      !q.state.data?.billedByProvider &&
      Date.now() - waitingSince < CONFIRM_TIMEOUT_MS
        ? CONFIRM_POLL_MS
        : false,
  });
  const plans = useQuery({ queryKey: ['plans'], queryFn: listPlans, staleTime: 60 * 60_000 });
  // Both leave the app for a Stripe page; the button stays busy until the browser has left.
  const leave = {
    onSuccess: ({ url }) => goToExternal(url),
    onError: (e) => toast.error(getApiError(e).message),
  };
  const checkout = useMutation({ mutationFn: (plan) => startCheckout(plan), ...leave });
  const portal = useMutation({ mutationFn: () => openBillingPortal(), ...leave });

  const sub = subscription.data;
  const busy = checkout.isPending || portal.isPending || checkout.isSuccess || portal.isSuccess;
  const canBuy = canManage && sub?.billingEnabled && !sub.billedByProvider;
  const dismissResult = () => {
    const next = new URLSearchParams(params);
    next.delete('checkout');
    setParams(next, { replace: true });
  };

  const retry = (query) => (
    <Button size="sm" variant="secondary" onClick={() => query.refetch()}>
      Retry
    </Button>
  );

  return (
    <>
      <PageHeader
        title="Billing"
        description="Your plan, what it includes, and how much of it you use."
        actions={
          canManage &&
          sub?.billingEnabled &&
          sub.hasBillingAccount && (
            <Button
              variant="secondary"
              loading={portal.isPending}
              disabled={busy}
              onClick={() => portal.mutate()}
            >
              Manage billing
            </Button>
          )
        }
      />
      <div className="space-y-6">
        <CheckoutResult
          result={checkoutResult}
          confirmed={Boolean(sub?.billedByProvider)}
          onDismiss={dismissResult}
        />
        <Card title="Current plan">
          {subscription.isPending ? (
            <SkeletonRows rows={3} label="Loading your plan" />
          ) : subscription.isError ? (
            <Alert tone="error" action={retry(subscription)}>
              {getApiError(subscription.error).message}
            </Alert>
          ) : (
            <div className="grid gap-6 md:grid-cols-2 [&>*]:min-w-0">
              <div>
                <p className="flex flex-wrap items-center gap-2 text-lg font-semibold text-ink-900">
                  {sub.plan?.name ?? 'No plan'}
                  <Badge tone={STATUS_LABELS[sub.status].tone}>
                    {STATUS_LABELS[sub.status].label}
                  </Badge>
                </p>
                <p className="mt-2 text-sm text-ink-600">
                  <StatusLine subscription={sub} />
                </p>
              </div>
              {sub.plan && (
                <div className="space-y-4">
                  {Object.entries(RESOURCE_LABELS).map(([key, label]) => (
                    <Meter
                      key={key}
                      label={label}
                      used={sub.usage[key]}
                      limit={sub.plan.limits[key]}
                    />
                  ))}
                  <p className="text-xs text-ink-500">
                    Pending invitations count as members. Archived stores and products do not count.
                  </p>
                </div>
              )}
            </div>
          )}
        </Card>

        <Card title="Plans" description={plansDescription(sub)}>
          {plans.isPending ? (
            <SkeletonRows rows={3} label="Loading plans" />
          ) : plans.isError ? (
            <Alert tone="error" action={retry(plans)}>
              {getApiError(plans.error).message}
            </Alert>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 [&>*]:min-w-0">
              {plans.data.map((plan) => (
                <PlanCard
                  key={plan.code}
                  plan={plan}
                  current={plan.code === sub?.plan?.code}
                  action={
                    canBuy &&
                    plan.onSale && (
                      <Button
                        className="w-full"
                        variant={plan.code === sub?.plan?.code ? 'primary' : 'secondary'}
                        loading={checkout.isPending && checkout.variables === plan.code}
                        disabled={busy}
                        onClick={() => checkout.mutate(plan.code)}
                      >
                        Choose {plan.name}
                      </Button>
                    )
                  }
                />
              ))}
            </ul>
          )}
        </Card>

        {sub?.hasBillingAccount && <InvoicesCard organizationId={organizationId} />}
      </div>
    </>
  );
}
