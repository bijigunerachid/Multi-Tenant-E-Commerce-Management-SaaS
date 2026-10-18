import { useNavigate } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { NoSymbolIcon } from '@heroicons/react/24/outline';
import { AuthLayout } from '../../layouts/AuthLayout.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { getApiError } from '../../lib/apiClient.js';
import { logout } from '../../services/authService.js';
import { switchOrganization } from '../../services/organizationService.js';
import { useApplySession } from '../auth/useSession.js';

/**
 * Shown instead of the app while the active organization is suspended by Vendora. Nothing is
 * deleted; the member gets back in as soon as it is reactivated (reloading checks again).
 */
export function SuspendedOrganizationPage({ session }) {
  const navigate = useNavigate();
  const toast = useToast();
  const applySession = useApplySession();
  const org = session.activeOrganization;
  const others = session.organizations.filter((o) => o.id !== org.id && o.status === 'ACTIVE');
  const switchTo = useMutation({
    mutationFn: (id) => switchOrganization(id),
    onSuccess: (s) => {
      applySession(s);
      navigate('/');
    },
    onError: (e) => toast.error(getApiError(e).message),
  });
  const signOut = useMutation({
    mutationFn: () => logout(),
    onSettled: () => {
      applySession(null);
      navigate('/login', { replace: true });
    },
  });

  return (
    <AuthLayout title={`${org.name} is suspended`}>
      <div className="space-y-5 text-sm text-ink-700">
        <NoSymbolIcon aria-hidden="true" className="mx-auto size-10 text-red-500" />
        <p>
          Vendora has suspended this organization, so it cannot be used for now. Its data is kept.
          {org.role === 'OWNER'
            ? ' Contact Vendora support to find out why and how to restore it.'
            : ' Ask its owner, who can contact Vendora support about it.'}
        </p>
        {others.length > 0 && (
          <div>
            <p className="mb-2 font-medium text-ink-900">Your other organizations</p>
            <ul className="space-y-2">
              {others.map((o) => (
                <li key={o.id}>
                  <Button
                    variant="secondary"
                    className="w-full justify-start"
                    loading={switchTo.isPending && switchTo.variables === o.id}
                    disabled={switchTo.isPending}
                    onClick={() => switchTo.mutate(o.id)}
                  >
                    Open {o.name}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => window.location.reload()}>
            Check again
          </Button>
          <Button variant="ghost" loading={signOut.isPending} onClick={() => signOut.mutate()}>
            Sign out
          </Button>
        </div>
      </div>
    </AuthLayout>
  );
}
