import { useEffect } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router';
import { queryClient } from '../lib/queryClient.js';
import { setSessionLostHandler } from '../lib/apiClient.js';
import { router } from '../routes/router.jsx';
import { ToastProvider } from '../components/ui/Toast.jsx';
import { SESSION_KEY } from '../features/auth/useSession.js';

export function App() {
  // When the API reports that the session or organization access is gone (signed out
  // elsewhere, membership deactivated, organization suspended), reload the session so the
  // route guards send the user to the right place.
  useEffect(() => {
    setSessionLostHandler(() => queryClient.invalidateQueries({ queryKey: SESSION_KEY }));
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  );
}
