import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { getSession } from '../../services/authService.js';
import { setCsrfToken } from '../../lib/apiClient.js';

export const SESSION_KEY = ['session'];

async function fetchSession() {
  const session = await getSession();
  setCsrfToken(session?.csrfToken);
  return session;
}

/** The current session: { user, organizations, activeOrganization, csrfToken } or null. */
export function useSession() {
  return useQuery({ queryKey: SESSION_KEY, queryFn: fetchSession, staleTime: 5 * 60_000 });
}

/**
 * Stores a session payload returned by a mutation (login, register, switch ...). When the
 * active organization changed, every tenant query is dropped so nothing from the previous
 * organization can be shown.
 */
export function useApplySession() {
  const queryClient = useQueryClient();
  return useCallback(
    (session) => {
      const previous = queryClient.getQueryData(SESSION_KEY);
      setCsrfToken(session?.csrfToken);
      if (previous?.activeOrganization?.id !== session?.activeOrganization?.id) {
        queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== SESSION_KEY[0] });
      }
      queryClient.setQueryData(SESSION_KEY, session);
    },
    [queryClient],
  );
}

export function useHasPermission() {
  const { data } = useSession();
  const permissions = data?.activeOrganization?.permissions;
  return useCallback((permission) => Boolean(permissions?.includes(permission)), [permissions]);
}
