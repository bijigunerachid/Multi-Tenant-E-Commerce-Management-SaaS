import { useQuery } from '@tanstack/react-query';
import { CheckIcon, MinusIcon } from '@heroicons/react/20/solid';
import { Alert, Badge, Card, PageHeader, SkeletonRows } from '../../components/ui/layout.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { getApiError } from '../../lib/apiClient.js';
import { formatDate, formatMoney } from '../../lib/format.js';
import { getSubscription, listPlans } from '../../services/billingService.js';
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
        <span className="font-medium text-slate-800">{label}</span>
        <span className={full ? 'font-medium text-red-700' : 'text-slate-600'}>
          {used.toLocaleString()} of {limit.toLocaleString()}
          {full && <span className="sr-only"> (limit reached)</span>}
        </span>
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={Math.min(used, limit)}
        className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100"
      >
        <div
          className={`h-full rounded-full ${full ? 'bg-red-600' : ratio >= 0.8 ? 'bg-amber-500' : 'bg-indigo-600'}`}
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

function PlanCard({ plan, current }) {
  return (
    <li
      className={`flex flex-col rounded-lg p-4 ring-1 ${current ? 'bg-indigo-50/60 ring-2 ring-indigo-600' : 'ring-slate-200'}`}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">{plan.name}</h3>
        {current && <Badge tone="accent">Current plan</Badge>}
      </div>
      <p className="mt-2 text-2xl font-semibold text-slate-900">
        {formatMoney(plan.priceMonthly, plan.currency)}
        <span className="text-sm font-normal text-slate-500"> / month</span>
      </p>
      <ul className="mt-3 space-y-1.5 text-sm text-slate-700">
        {Object.keys(RESOURCE_LABELS).map((key) => (
          <li key={key}>{countOf(key, plan.limits[key])}</li>
        ))}
        {Object.entries(FEATURE_LABELS).map(([key, label]) => (
          <li key={key} className="flex items-center gap-1.5">
            {plan.features[key] ? (
              <CheckIcon aria-hidden="true" className="size-4 text-emerald-600" />
            ) : (
              <MinusIcon aria-hidden="true" className="size-4 text-slate-400" />
            )}
            <span className={plan.features[key] ? '' : 'text-slate-500'}>
              {label}
              <span className="sr-only">
                {plan.features[key] ? ': included' : ': not included'}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </li>
  );
}

export function BillingPage() {
  const { data: session } = useSession();
  const organizationId = session.activeOrganization.id;
  const subscription = useQuery({
    queryKey: ['subscription', organizationId],
    queryFn: getSubscription,
  });
  const plans = useQuery({ queryKey: ['plans'], queryFn: listPlans, staleTime: 60 * 60_000 });

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
      />
      <div className="space-y-6">
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
                <p className="flex flex-wrap items-center gap-2 text-lg font-semibold text-slate-900">
                  {subscription.data.plan?.name ?? 'No plan'}
                  <Badge tone={STATUS_LABELS[subscription.data.status].tone}>
                    {STATUS_LABELS[subscription.data.status].label}
                  </Badge>
                </p>
                <p className="mt-2 text-sm text-slate-600">
                  <StatusLine subscription={subscription.data} />
                </p>
              </div>
              {subscription.data.plan && (
                <div className="space-y-4">
                  {Object.entries(RESOURCE_LABELS).map(([key, label]) => (
                    <Meter
                      key={key}
                      label={label}
                      used={subscription.data.usage[key]}
                      limit={subscription.data.plan.limits[key]}
                    />
                  ))}
                  <p className="text-xs text-slate-500">
                    Pending invitations count as members. Archived stores and products do not count.
                  </p>
                </div>
              )}
            </div>
          )}
        </Card>

        <Card title="Plans" description="Prices are in US dollars, per month.">
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
                  current={plan.code === subscription.data?.plan?.code}
                />
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
