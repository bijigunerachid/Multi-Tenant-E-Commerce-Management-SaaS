import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { CheckIcon, MinusIcon } from '@heroicons/react/20/solid';
import { formatMoney } from '../../lib/format.js';
import { getPublicPlans } from '../../services/planService.js';
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js';
import { ShelfPreview } from './ShelfPreview.jsx';
import { Faq, PlanFacts, primaryCta, secondaryCta } from './shared.jsx';

// The public homepage. Everything it states is something Vendora does today; there are no
// testimonials, customer logos or usage figures, because there are none to show yet.

const STOCK_POINTS = [
  {
    title: 'Reserved the moment an order is placed',
    body: 'Placing an order sets its units aside, so two sales can never take the same last item. Cancelling puts them back on the shelf.',
  },
  {
    title: 'Told when a shelf runs low',
    body: 'Set a threshold for each product variant. The people who restock hear about it when it is reached, in Vendora or by email.',
  },
  {
    title: 'A history behind every count',
    body: 'Every delivery, sale and correction is recorded with who made it and why: damaged, lost, found or returned.',
  },
  {
    title: 'Every store, side by side',
    body: 'Each store keeps its own stock and orders, in its own currency and time zone. Reports put them next to each other.',
  },
];

// The order lifecycle, as the app runs it, with what each step does to stock.
const ORDER_STEPS = [
  { status: 'Draft', effect: 'Build the order. Nothing is reserved yet.' },
  { status: 'Pending', effect: 'Placed: its units are reserved.' },
  { status: 'Confirmed', effect: 'Accepted by your team.' },
  { status: 'Processing', effect: 'Being picked and packed.' },
  { status: 'Shipped', effect: 'The units leave the shelf.' },
  { status: 'Delivered', effect: 'In your customer’s hands.' },
];

// Mirrors the role matrix in backend/src/modules/auth/permissions.js.
const ROLES = ['Owner', 'Store manager', 'Inventory manager', 'Order manager', 'Analyst'];
const ACCESS = [
  ['See products and stock', [1, 1, 1, 1, 1]],
  ['Edit products and categories', [1, 1, 0, 0, 0]],
  ['Receive and adjust stock', [1, 1, 1, 0, 0]],
  ['Create and process orders', [1, 1, 0, 1, 0]],
  ['Manage customers', [1, 1, 0, 1, 0]],
  ['Read reports', [1, 1, 0, 0, 1]],
  ['Invite and manage the team', [1, 0, 0, 0, 0]],
  ['Billing and the audit log', [1, 0, 0, 0, 0]],
];

const TRUST_POINTS = [
  {
    title: 'Your records, kept apart',
    body: 'Each organization’s data is separated in the database, and every request is checked against the organization it belongs to.',
  },
  {
    title: 'A log of what matters',
    body: 'Role changes, stock corrections, cancellations, exports and billing changes are written to an audit log that cannot be edited.',
  },
  {
    title: 'Card details never touch Vendora',
    body: 'Payments go through Stripe’s own checkout and customer portal.',
  },
  {
    title: 'Access ends when you say so',
    body: 'Sign out of every device from your profile. A team member you deactivate loses access on their next click.',
  },
];

function SectionHeading({ id, title, children }) {
  return (
    <div className="max-w-2xl">
      <h2 id={id} className="text-2xl font-bold tracking-tight text-ink-900 sm:text-3xl">
        {title}
      </h2>
      {children && <p className="mt-3 text-base text-ink-600">{children}</p>}
    </div>
  );
}

function PointList({ points }) {
  return (
    <dl className="mt-10 grid gap-x-12 sm:grid-cols-2">
      {points.map((p) => (
        <div key={p.title} className="border-t border-ink-200 py-6">
          <dt className="text-base font-semibold text-ink-900">{p.title}</dt>
          <dd className="mt-2 text-sm leading-6 text-ink-600">{p.body}</dd>
        </div>
      ))}
    </dl>
  );
}

function PlansSummary() {
  const plans = useQuery({
    queryKey: ['public-plans'],
    queryFn: getPublicPlans,
    staleTime: 5 * 60_000,
  });
  if (!plans.data) return null;
  return (
    <ul className="mt-10 grid gap-4 md:grid-cols-3 [&>*]:min-w-0">
      {plans.data.map((plan) => (
        <li key={plan.code} className="rounded-md border border-ink-200 bg-white p-5">
          <h3 className="text-base font-semibold text-ink-900">{plan.name}</h3>
          <p className="mt-2 text-2xl font-bold tabular-nums text-ink-900">
            {formatMoney(plan.priceMonthly, plan.currency)}
            <span className="text-sm font-normal text-ink-500"> per month</span>
          </p>
          <PlanFacts plan={plan} className="mt-4" />
        </li>
      ))}
    </ul>
  );
}

export function LandingPage() {
  useDocumentTitle(null);
  return (
    <>
      {/* Hero: the stockroom itself, not a slogan over a gradient. */}
      <section aria-labelledby="hero-title" className="border-b border-ink-200">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:px-8 lg:py-24">
          <div>
            <h1
              id="hero-title"
              className="text-4xl font-bold leading-[1.05] tracking-tight text-ink-900 sm:text-5xl lg:text-[3.5rem]"
            >
              Know what’s on every shelf, in every store.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-ink-600">
              Vendora is the back office for independent shops: stock, orders and customers for each
              of your stores, with a team that sees what their job needs and nothing more.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link to="/register" className={primaryCta}>
                Start your free trial
              </Link>
              <Link to="/pricing" className={secondaryCta}>
                See pricing
              </Link>
            </div>
            <p className="mt-4 text-sm text-ink-500">14 days of the Growth plan. No card needed.</p>
          </div>
          <ShelfPreview />
        </div>
      </section>

      <section aria-labelledby="features" className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:px-8">
        <SectionHeading id="features" title="Stock that adds up">
          Every unit is accounted for, from the delivery at the back door to the customer’s bag.
        </SectionHeading>
        <PointList points={STOCK_POINTS} />
      </section>

      <section aria-labelledby="orders-title" className="border-y border-ink-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:px-8">
          <SectionHeading id="orders-title" title="From draft to delivered">
            Each order moves through the same steps, and stock follows it. Cancel any time before it
            ships: the reserved units go back on the shelf and the reason is kept.
          </SectionHeading>
          <ol className="mt-10 grid gap-px overflow-hidden rounded-md border border-ink-200 bg-ink-200 sm:grid-cols-3 lg:grid-cols-6">
            {ORDER_STEPS.map((step, i) => (
              <li key={step.status} className="bg-white p-4">
                <p className="text-xs font-medium tabular-nums text-ink-500">Step {i + 1}</p>
                <p className="mt-1 text-sm font-semibold text-ink-900">{step.status}</p>
                <p className="mt-1 text-sm text-ink-600">{step.effect}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section
        aria-labelledby="team-title"
        className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:px-8"
      >
        <SectionHeading id="team-title" title="Your team, with the right access">
          Five roles cover how shops are run. Everyone gets what their work needs; the owner keeps
          the team, billing and the audit log.
        </SectionHeading>
        <div className="mt-10 overflow-x-auto rounded-md border border-ink-200 bg-white">
          <table className="w-full min-w-[40rem] text-sm">
            <caption className="sr-only">What each role can do</caption>
            <thead className="bg-ink-50 text-left text-[0.8125rem] font-semibold text-ink-600">
              <tr>
                <th scope="col" className="px-4 py-3">
                  <span className="sr-only">Task</span>
                </th>
                {ROLES.map((r) => (
                  <th key={r} scope="col" className="px-3 py-3 text-center">
                    {r}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {ACCESS.map(([task, allowed]) => (
                <tr key={task}>
                  <th scope="row" className="px-4 py-3 text-left font-medium text-ink-900">
                    {task}
                  </th>
                  {allowed.map((yes, i) => (
                    <td key={ROLES[i]} className="px-3 py-3 text-center">
                      {yes ? (
                        <CheckIcon aria-label="Yes" className="mx-auto size-5 text-brand-600" />
                      ) : (
                        <MinusIcon aria-label="No" className="mx-auto size-5 text-ink-300" />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="reports-title" className="border-y border-ink-200 bg-white">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-20 sm:px-6 lg:grid-cols-2 lg:px-8">
          <SectionHeading id="reports-title" title="Numbers you can act on">
            Sales by day, week or month, by product and by store, for any period. Revenue counts
            what has shipped, so it matches what actually left the shop.
          </SectionHeading>
          <dl className="grid grid-cols-2 gap-px self-start overflow-hidden rounded-md border border-ink-200 bg-ink-200 text-sm">
            {[
              [
                'Dashboard',
                'Revenue, orders, average order value and open orders against the previous period.',
              ],
              ['Alerts', 'New orders and low stock, in the app and by email if you want them.'],
              ['Exports', 'Orders, customers and every report as CSV, ready for your accountant.'],
              ['History', 'Each stock movement and order change, with who did it.'],
            ].map(([title, body]) => (
              <div key={title} className="bg-white p-4">
                <dt className="font-semibold text-ink-900">{title}</dt>
                <dd className="mt-1 text-ink-600">{body}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section
        aria-labelledby="trust-title"
        className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:px-8"
      >
        <SectionHeading id="trust-title" title="Built to be trusted with your shop" />
        <PointList points={TRUST_POINTS} />
      </section>

      <section aria-labelledby="pricing-title" className="border-y border-ink-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:px-8">
          <SectionHeading id="pricing-title" title="Pay for the shop you run">
            Every plan includes everything above. Plans differ in how many stores, people and
            products they hold.
          </SectionHeading>
          <PlansSummary />
          <p className="mt-6 text-sm">
            <Link to="/pricing" className="font-semibold text-brand-600 hover:text-brand-500">
              Compare plans in detail
            </Link>
          </p>
        </div>
      </section>

      <section
        aria-labelledby="faq-title"
        className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:px-8 [&>*]:max-w-3xl"
      >
        <h2 id="faq-title" className="text-2xl font-bold tracking-tight text-ink-900">
          Questions shop owners ask
        </h2>
        <Faq />
      </section>

      <section className="bg-brand-800">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-4 py-16 sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-white">
              Set up your first store today.
            </h2>
            <p className="mt-2 text-brand-100">
              Create your organization, add your products and receive your stock.
            </p>
          </div>
          <Link
            to="/register"
            className="inline-flex shrink-0 items-center rounded-md bg-white px-4 py-2.5 text-sm font-semibold text-brand-800 hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            Start your free trial
          </Link>
        </div>
      </section>
    </>
  );
}
