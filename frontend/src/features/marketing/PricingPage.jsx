import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { CheckIcon } from '@heroicons/react/20/solid';
import { Alert, SkeletonRows } from '../../components/ui/layout.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { getApiError } from '../../lib/apiClient.js';
import { formatMoney } from '../../lib/format.js';
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js';
import { getPublicPlans } from '../../services/planService.js';
import { Faq, PlanFacts, primaryCta, secondaryCta } from './shared.jsx';

// What every plan includes. Plans differ only in their limits and CSV exports (from the API).
const INCLUDED = [
  'Inventory per store, with reservations and low-stock alerts',
  'Orders from draft to delivery, with stock following each step',
  'Customers, their addresses and order history',
  'Dashboard and reports by day, week, month, product and store',
  'Five team roles, invitations and an audit log',
  'New-order and low-stock notifications, in the app and by email',
];

export function PricingPage() {
  useDocumentTitle('Pricing');
  const plans = useQuery({
    queryKey: ['public-plans'],
    queryFn: getPublicPlans,
    staleTime: 5 * 60_000,
  });
  // The middle plan is the one the trial runs on.
  const trialPlan = 'growth';

  return (
    <>
      <section className="mx-auto max-w-6xl px-4 pb-10 pt-16 sm:px-6 lg:px-8 lg:pt-20">
        <h1 className="max-w-3xl text-4xl font-bold leading-tight tracking-tight text-ink-900 sm:text-5xl">
          Pay for the stores and team you have.
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-ink-600">
          Every plan starts with a 14-day trial of Growth, without a card. Prices are in US dollars,
          per month, per organization.
        </p>
      </section>

      <section aria-label="Plans" className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        {plans.isPending ? (
          <SkeletonRows rows={3} label="Loading plans" />
        ) : plans.isError ? (
          <Alert
            tone="error"
            action={
              <Button size="sm" variant="secondary" onClick={() => plans.refetch()}>
                Retry
              </Button>
            }
          >
            Prices could not be loaded. {getApiError(plans.error).message}
          </Alert>
        ) : (
          <ul className="grid gap-4 md:grid-cols-3 [&>*]:min-w-0">
            {plans.data.map((plan) => {
              const featured = plan.code === trialPlan;
              return (
                <li
                  key={plan.code}
                  className={`flex flex-col rounded-md border bg-white p-6 ${featured ? 'border-brand-600 ring-1 ring-brand-600' : 'border-ink-200'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-lg font-semibold text-ink-900">{plan.name}</h2>
                    {featured && (
                      <span className="rounded-md bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 ring-1 ring-inset ring-brand-600/25">
                        The trial plan
                      </span>
                    )}
                  </div>
                  <p className="mt-4 text-4xl font-bold tabular-nums tracking-tight text-ink-900">
                    {formatMoney(plan.priceMonthly, plan.currency)}
                    <span className="text-base font-normal text-ink-500"> per month</span>
                  </p>
                  <PlanFacts plan={plan} className="mt-6 flex-1" />
                  <Link
                    to="/register"
                    className={`mt-8 ${featured ? primaryCta : secondaryCta} w-full text-sm`}
                  >
                    Start your free trial
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section
        aria-labelledby="included-title"
        className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8"
      >
        <h2 id="included-title" className="text-2xl font-bold tracking-tight text-ink-900">
          In every plan
        </h2>
        <ul className="mt-6 grid gap-x-12 gap-y-3 text-sm text-ink-700 sm:grid-cols-2">
          {INCLUDED.map((item) => (
            <li key={item} className="flex gap-2">
              <CheckIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-brand-600" />
              {item}
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-labelledby="pricing-faq-title"
        className="mx-auto max-w-6xl px-4 pb-20 sm:px-6 lg:px-8 [&>*]:max-w-3xl"
      >
        <h2 id="pricing-faq-title" className="text-2xl font-bold tracking-tight text-ink-900">
          Billing questions
        </h2>
        <Faq />
      </section>
    </>
  );
}
