import { Link } from 'react-router';

/**
 * Vendora's mark: a shelf tag, the label every stocked item carries. Drawn, not lettered, so it
 * reads the same at 16 px in a tab and 32 px in the sidebar.
 */
export function LogoMark({ className = 'size-8', onDark = false }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <path
        d="M4 9.5A3.5 3.5 0 0 1 7.5 6h13.1a3.5 3.5 0 0 1 2.6 1.2l4.4 5.1a3.5 3.5 0 0 1 0 4.6l-4.4 5.1a3.5 3.5 0 0 1-2.6 1.2H7.5A3.5 3.5 0 0 1 4 19.7z"
        transform="translate(0 2.6)"
        className={onDark ? 'fill-brand-100' : 'fill-brand-700'}
      />
      <circle cx="22" cy="17.2" r="2.1" className={onDark ? 'fill-brand-800' : 'fill-ink-50'} />
      <path
        d="M9.5 13.2l3.4 8.4 3.4-8.4"
        fill="none"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={onDark ? 'stroke-brand-800' : 'stroke-ink-50'}
      />
    </svg>
  );
}

export function Logo({ className = '', onDark = false }) {
  return (
    <span
      translate="no"
      className={`inline-flex items-center gap-2 text-lg font-bold tracking-tight ${onDark ? 'text-white' : 'text-ink-900'} ${className}`}
    >
      <LogoMark onDark={onDark} />
      Vendora
    </span>
  );
}

/** Centered card used by sign-in, registration and the other account pages. */
export function AuthLayout({ title, subtitle, children, footer }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <Link to="/" className="rounded-md focus-visible:outline-2 focus-visible:outline-brand-600">
        <Logo className="text-lg" />
      </Link>
      <main className="mt-8 w-full max-w-md">
        <div className="rounded-lg border border-ink-200 bg-white px-6 py-8 sm:px-8">
          <h1 className="text-xl font-semibold tracking-tight text-ink-900">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-ink-600">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
        {footer && <div className="mt-6 text-center text-sm text-ink-600">{footer}</div>}
      </main>
    </div>
  );
}

export const linkClass =
  'font-medium text-brand-600 hover:text-brand-500 focus-visible:outline-2 focus-visible:outline-brand-600 rounded-sm';
