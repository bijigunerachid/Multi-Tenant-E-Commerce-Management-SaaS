import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  XCircleIcon,
} from '@heroicons/react/20/solid';

const ALERT_STYLES = {
  error: { box: 'bg-red-50 text-red-800 ring-red-200', Icon: XCircleIcon, icon: 'text-red-500' },
  warning: {
    box: 'bg-amber-50 text-amber-900 ring-amber-200',
    Icon: ExclamationTriangleIcon,
    icon: 'text-amber-500',
  },
  success: {
    box: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
    Icon: CheckCircleIcon,
    icon: 'text-emerald-500',
  },
  info: {
    box: 'bg-sky-50 text-sky-900 ring-sky-200',
    Icon: InformationCircleIcon,
    icon: 'text-sky-500',
  },
};

export function Alert({ tone = 'info', title, children, action }) {
  const { box, Icon, icon } = ALERT_STYLES[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`flex gap-3 rounded-md p-3.5 text-sm ring-1 ring-inset ${box}`}
    >
      <Icon aria-hidden="true" className={`mt-0.5 size-5 shrink-0 ${icon}`} />
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={title ? 'mt-1' : ''}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function Card({ title, description, actions, children, className = '' }) {
  return (
    <section className={`rounded-lg border border-slate-200 bg-white shadow-sm ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div>
            {title && <h2 className="text-base font-semibold text-slate-900">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-slate-600">{description}</p>}
          </div>
          {actions && <div className="flex gap-2">{actions}</div>}
        </header>
      )}
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

export function PageHeader({ title, description, actions }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-600">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

const BADGE_TONES = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-500/20',
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  warning: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  danger: 'bg-red-50 text-red-700 ring-red-600/20',
  accent: 'bg-indigo-50 text-indigo-700 ring-indigo-600/20',
};

export function Badge({ tone = 'neutral', children }) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${BADGE_TONES[tone]}`}
    >
      {children}
    </span>
  );
}

export function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="px-4 py-10 text-center">
      {Icon && <Icon aria-hidden="true" className="mx-auto size-10 text-slate-400" />}
      <h3 className="mt-2 text-sm font-semibold text-slate-900">{title}</h3>
      {description && <p className="mt-1 text-sm text-slate-600">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function SkeletonRows({ rows = 3, label = 'Loading' }) {
  return (
    <ul aria-label={label} aria-busy="true" className="divide-y divide-slate-100">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="flex items-center justify-between gap-4 py-3">
          <span className="h-4 w-40 animate-pulse rounded bg-slate-200" />
          <span className="h-4 w-20 animate-pulse rounded bg-slate-200" />
        </li>
      ))}
    </ul>
  );
}
