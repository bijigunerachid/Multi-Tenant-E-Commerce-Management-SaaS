import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Client errors (4xx) will not fix themselves on retry; network and 5xx errors might.
      retry: (failureCount, error) => {
        const status = error?.response?.status;
        if (status && status < 500) return false;
        return failureCount < 2;
      },
      refetchOnWindowFocus: false,
    },
  },
});
