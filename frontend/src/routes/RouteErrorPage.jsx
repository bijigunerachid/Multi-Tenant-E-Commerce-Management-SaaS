import { useRouteError } from 'react-router';

/** Shown when rendering a route throws. Details stay in the console, not on screen. */
export function RouteErrorPage() {
  const error = useRouteError();
  // eslint-disable-next-line no-console -- keep the details available to developers only
  console.error(error);

  return (
    <main role="alert" className="mx-auto max-w-xl px-4 py-24 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="mt-2 text-sm text-slate-600">
        An unexpected error occurred while showing this page.
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="mt-6 rounded-md bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
      >
        Reload the page
      </button>
    </main>
  );
}
