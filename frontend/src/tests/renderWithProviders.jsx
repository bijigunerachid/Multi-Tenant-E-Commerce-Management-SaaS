import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { routes } from '../routes/router.jsx';
import { ToastProvider } from '../components/ui/Toast.jsx';

/** Renders the real route tree at `path` with a fresh, retry-free query client. */
export function renderRoute(path) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { ...utils, router, queryClient };
}

/** A realistic session payload, as returned by GET /auth/me. */
export function sessionFixture({
  role = 'OWNER',
  permissions,
  verified = true,
  withOrganization = true,
} = {}) {
  const org = {
    id: 'org-1',
    name: 'Atlas Outfitters',
    slug: 'atlas-outfitters',
    status: 'ACTIVE',
    role,
  };
  return {
    user: {
      id: 'user-1',
      email: 'amina@example.com',
      name: 'Amina Haddad',
      emailVerified: verified,
      platformRole: 'NONE',
    },
    organizations: withOrganization ? [org] : [],
    activeOrganization: withOrganization
      ? {
          ...org,
          membershipId: 'membership-1',
          permissions: permissions ?? [
            'org:read',
            'org:update',
            'member:read',
            'member:manage',
            'org:transfer_ownership',
          ],
        }
      : null,
    csrfToken: 'csrf-token',
  };
}
