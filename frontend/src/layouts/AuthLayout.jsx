import { Link } from 'react-router';

export function Logo({ className = '' }) {
  return (
    <span className={`inline-flex items-center gap-2 font-semibold text-slate-900 ${className}`}>
      <span
        aria-hidden="true"
        className="grid size-8 place-items-center rounded-md bg-indigo-600 text-base font-bold text-white"
      >
        V
      </span>
      Vendora
    </span>
  );
}

/** Centered card used by sign-in, registration and the other account pages. */
export function AuthLayout({ title, subtitle, children, footer }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <Link to="/" className="rounded-md focus-visible:outline-2 focus-visible:outline-indigo-600">
        <Logo className="text-lg" />
      </Link>
      <main className="mt-8 w-full max-w-md">
        <div className="rounded-lg border border-slate-200 bg-white px-6 py-8 shadow-sm sm:px-8">
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-slate-600">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
        {footer && <div className="mt-6 text-center text-sm text-slate-600">{footer}</div>}
      </main>
    </div>
  );
}

export const linkClass =
  'font-medium text-indigo-600 hover:text-indigo-500 focus-visible:outline-2 focus-visible:outline-indigo-600 rounded-sm';
