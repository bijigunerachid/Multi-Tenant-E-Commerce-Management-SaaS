import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { Bars3Icon, XMarkIcon } from '@heroicons/react/24/outline';
import { Logo } from '../../layouts/AuthLayout.jsx';
import { useSession } from '../auth/useSession.js';

const linkClass =
  'rounded-md px-2.5 py-2 text-sm font-medium text-ink-700 hover:bg-ink-100 hover:text-ink-900 focus-visible:outline-2 focus-visible:outline-brand-600';
const primaryClass =
  'inline-flex items-center justify-center rounded-md bg-brand-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-brand-500 active:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600';

/** Header actions: visitors sign in or start a trial; signed-in people go back to the app. */
function Actions({ signedIn, onNavigate }) {
  return signedIn ? (
    <Link to="/" onClick={onNavigate} className={primaryClass}>
      Open Vendora
    </Link>
  ) : (
    <>
      <Link to="/login" onClick={onNavigate} className={linkClass}>
        Sign in
      </Link>
      <Link to="/register" onClick={onNavigate} className={primaryClass}>
        Start free trial
      </Link>
    </>
  );
}

/** Frame of the public pages: the homepage and pricing. */
export function MarketingLayout({ children }) {
  const { data: session } = useSession();
  const signedIn = Boolean(session);
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setMenuOpen(false), [location.pathname, location.hash]);
  // Section links (/#features): scroll to the section once it is on the page; a new page
  // starts at the top.
  useEffect(() => {
    if (!location.hash) {
      window.scrollTo(0, 0);
      return undefined;
    }
    const frame = requestAnimationFrame(() =>
      document.getElementById(location.hash.slice(1))?.scrollIntoView(),
    );
    return () => cancelAnimationFrame(frame);
  }, [location.pathname, location.hash]);

  return (
    <div className="flex min-h-screen flex-col bg-ink-50">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-30 border-b border-ink-200 bg-ink-50/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6 lg:px-8">
          <Link
            to="/"
            aria-label="Vendora home"
            className="rounded-md focus-visible:outline-2 focus-visible:outline-brand-600"
          >
            <Logo />
          </Link>
          <nav aria-label="Site" className="hidden items-center gap-1 md:flex">
            <Link to="/#features" className={linkClass}>
              Features
            </Link>
            <NavLink to="/pricing" className={linkClass}>
              Pricing
            </NavLink>
          </nav>
          <div className="ml-auto hidden items-center gap-2 md:flex">
            <Actions signedIn={signedIn} />
          </div>
          <button
            type="button"
            aria-expanded={menuOpen}
            aria-controls="site-menu"
            onClick={() => setMenuOpen((v) => !v)}
            className="ml-auto rounded-md p-1.5 text-ink-700 hover:bg-ink-100 focus-visible:outline-2 focus-visible:outline-brand-600 md:hidden"
          >
            {menuOpen ? (
              <XMarkIcon aria-hidden="true" className="size-6" />
            ) : (
              <Bars3Icon aria-hidden="true" className="size-6" />
            )}
            <span className="sr-only">{menuOpen ? 'Close menu' : 'Open menu'}</span>
          </button>
        </div>
        {menuOpen && (
          <div id="site-menu" className="border-t border-ink-200 px-4 py-3 md:hidden">
            <nav aria-label="Site, mobile" className="flex flex-col gap-1">
              <Link to="/#features" className={linkClass}>
                Features
              </Link>
              <Link to="/pricing" className={linkClass}>
                Pricing
              </Link>
            </nav>
            <div className="mt-3 flex flex-col gap-2 border-t border-ink-200 pt-3">
              <Actions signedIn={signedIn} onNavigate={() => setMenuOpen(false)} />
            </div>
          </div>
        )}
      </header>

      <main id="main" className="flex-1">
        {children ?? <Outlet />}
      </main>

      <footer className="border-t border-ink-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6 md:flex-row md:items-start md:justify-between lg:px-8">
          <div className="max-w-xs">
            <Logo />
            <p className="mt-3 text-sm text-ink-600">
              The back office for independent shops: stock, orders and customers for every store you
              run.
            </p>
          </div>
          <nav aria-label="Footer" className="grid grid-cols-2 gap-x-12 gap-y-2 text-sm">
            <Link to="/pricing" className="text-ink-700 hover:text-ink-900">
              Pricing
            </Link>
            <Link to="/login" className="text-ink-700 hover:text-ink-900">
              Sign in
            </Link>
            <Link to="/#features" className="text-ink-700 hover:text-ink-900">
              Features
            </Link>
            <Link to="/register" className="text-ink-700 hover:text-ink-900">
              Create an account
            </Link>
            <Link to="/status" className="text-ink-700 hover:text-ink-900">
              System status
            </Link>
          </nav>
        </div>
        <p className="border-t border-ink-100 px-4 py-4 text-center text-xs text-ink-500">
          © {new Date().getFullYear()} <span translate="no">Vendora</span>
        </p>
      </footer>
    </div>
  );
}
