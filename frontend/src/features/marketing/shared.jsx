import { useQuery } from '@tanstack/react-query';
import { CheckIcon, MinusIcon } from '@heroicons/react/20/solid';
import { getPublicPlans } from '../../services/planService.js';

export const primaryCta =
  'inline-flex items-center justify-center rounded-md bg-brand-600 px-5 py-3 text-base font-semibold text-white hover:bg-brand-500 active:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600';
export const secondaryCta =
  'inline-flex items-center justify-center rounded-md px-5 py-3 text-base font-semibold text-ink-900 ring-1 ring-inset ring-ink-300 hover:bg-white hover:ring-ink-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600';

const count = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** A plan's limits and features, as a short list. */
export function PlanFacts({ plan, className = '' }) {
  const facts = [
    [true, count(plan.limits.stores, 'store', 'stores')],
    [true, count(plan.limits.members, 'team member', 'team members')],
    [true, count(plan.limits.products, 'product', 'products')],
    [plan.features.csvExport, 'CSV exports'],
  ];
  return (
    <ul className={`space-y-2 text-sm text-ink-700 ${className}`}>
      {facts.map(([included, label]) => (
        <li key={label} className="flex items-center gap-2">
          {included ? (
            <CheckIcon aria-hidden="true" className="size-4 shrink-0 text-brand-600" />
          ) : (
            <MinusIcon aria-hidden="true" className="size-4 shrink-0 text-ink-300" />
          )}
          <span className={included ? '' : 'text-ink-500'}>
            {label}
            {!included && <span className="sr-only">: not included</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

const listNames = (names) =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

/**
 * Frequently asked questions. Answers that depend on the plans (store counts, which plans
 * export) are written from the plans the API returns, so they always match pricing.
 */
export function Faq() {
  const plans = useQuery({
    queryKey: ['public-plans'],
    queryFn: getPublicPlans,
    staleTime: 5 * 60_000,
  });
  const list = plans.data ?? [];
  const stores = listNames(list.map((p) => `${p.name} ${p.limits.stores}`));
  const exporters = listNames(list.filter((p) => p.features.csvExport).map((p) => p.name));

  const items = [
    [
      'Do I need a card to start?',
      'No. The 14-day trial starts when you create your organization, with everything in the Growth plan.',
    ],
    [
      'What happens when the trial ends?',
      'Your organization becomes read-only until you choose a plan: you can still see and export everything, and nothing is deleted.',
    ],
    [
      'Can I change or cancel my plan?',
      'Yes, at any time, from Billing. Changes, card details, invoices and cancellation are handled in Stripe’s secure customer portal; a cancellation takes effect at the end of the period you paid for.',
    ],
    list.length > 0 && [
      'How many stores can I run?',
      `It depends on the plan: ${stores}. Archived stores do not count, and their history stays.`,
    ],
    exporters && [
      'Can I get my data out?',
      `Yes. Orders, customers and reports export to CSV on the ${exporters} ${exporters.includes(' and ') ? 'plans' : 'plan'}.`,
    ],
  ].filter(Boolean);

  return (
    <div className="mt-8 divide-y divide-ink-200 border-y border-ink-200">
      {items.map(([question, answer]) => (
        <details key={question} className="group py-1">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-md py-4 text-base font-semibold text-ink-900 focus-visible:outline-2 focus-visible:outline-brand-600 [&::-webkit-details-marker]:hidden">
            {question}
            <span
              aria-hidden="true"
              className="text-xl leading-none text-ink-400 group-open:rotate-45 motion-safe:transition-transform"
            >
              +
            </span>
          </summary>
          <p className="pb-5 text-sm leading-6 text-ink-600">{answer}</p>
        </details>
      ))}
    </div>
  );
}
