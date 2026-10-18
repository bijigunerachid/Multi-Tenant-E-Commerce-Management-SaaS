import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <main className="mx-auto max-w-xl px-4 py-24 text-center">
      <p className="text-sm font-semibold text-brand-600">404</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="mt-2 text-sm text-ink-600">The page you are looking for does not exist.</p>
      <Link
        to="/"
        className="mt-6 inline-block rounded-md bg-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
      >
        Go to the home page
      </Link>
    </main>
  );
}
