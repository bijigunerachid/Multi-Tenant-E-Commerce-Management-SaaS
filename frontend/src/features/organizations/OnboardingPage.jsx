import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { BuildingStorefrontIcon } from '@heroicons/react/24/outline';
import { AuthLayout } from '../../layouts/AuthLayout.jsx';
import { SelectField, TextField } from '../../components/ui/fields.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Alert, Badge } from '../../components/ui/layout.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useServerErrors } from '../../hooks/useServerErrors.js';
import { getApiError } from '../../lib/apiClient.js';
import { CURRENCY_OPTIONS, TIMEZONE_OPTIONS, browserTimeZone } from '../../lib/locale.js';
import { ROLE_LABELS } from '../../lib/roles.js';
import { logout, resendVerification } from '../../services/authService.js';
import { createOrganization, switchOrganization } from '../../services/organizationService.js';
import { nameField } from '../auth/schemas.js';
import { useApplySession, useSession } from '../auth/useSession.js';

const schema = z.object({
  name: nameField,
  storeName: nameField,
  defaultCurrency: z.string().min(1, 'Choose a currency'),
  timezone: z.string().min(1, 'Choose a time zone'),
});

/**
 * Shown when the signed-in user has no active organization: create one, or open one of the
 * organizations they already belong to.
 */
export function OnboardingPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const applySession = useApplySession();
  const { data: session } = useSession();
  const verified = session.user.emailVerified;
  const available = session.organizations.filter((o) => o.status === 'ACTIVE');

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { name: '', storeName: '', defaultCurrency: 'USD', timezone: browserTimeZone() },
  });
  const [formError, handleError] = useServerErrors(setError);

  const create = useMutation({
    mutationFn: createOrganization,
    onSuccess: (result) => {
      applySession(result.session);
      toast.success(`${result.organization.name} is ready.`);
      navigate('/', { replace: true });
    },
    onError: handleError,
  });
  const open = useMutation({
    mutationFn: switchOrganization,
    onSuccess: (s) => {
      applySession(s);
      navigate('/', { replace: true });
    },
    onError: (e) => toast.error(getApiError(e).message),
  });
  const resend = useMutation({
    mutationFn: resendVerification,
    onSuccess: () => toast.success(`We sent a new link to ${session.user.email}.`),
    onError: (e) => toast.error(getApiError(e).message),
  });
  const signOut = useMutation({
    mutationFn: logout,
    onSettled: () => {
      applySession(null);
      navigate('/login', { replace: true });
    },
  });

  return (
    <AuthLayout
      title="Set up your organization"
      subtitle="An organization holds your stores, team, products and orders."
      footer={
        <button
          type="button"
          onClick={() => signOut.mutate()}
          className="font-medium text-slate-600 hover:text-slate-900"
        >
          Sign out ({session.user.email})
        </button>
      }
    >
      {available.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-medium text-slate-800">Your organizations</h2>
          <ul className="mt-2 divide-y divide-slate-100 rounded-md border border-slate-200">
            {available.map((org) => (
              <li key={org.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900">{org.name}</p>
                  <Badge>{ROLE_LABELS[org.role]}</Badge>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={open.isPending && open.variables === org.id}
                  onClick={() => open.mutate(org.id)}
                >
                  Open
                </Button>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-slate-600">Or create a new organization:</p>
        </div>
      )}

      {!verified && (
        <div className="mb-5">
          <Alert
            tone="warning"
            title="Confirm your email address first"
            action={
              <Button
                size="sm"
                variant="secondary"
                loading={resend.isPending}
                onClick={() => resend.mutate()}
              >
                Resend link
              </Button>
            }
          >
            We sent a link to {session.user.email}.
          </Alert>
        </div>
      )}

      <form noValidate onSubmit={handleSubmit((v) => create.mutate(v))} className="space-y-5">
        {formError && <Alert tone="error">{formError}</Alert>}
        <fieldset disabled={!verified} className="space-y-5 disabled:opacity-60">
          <TextField
            label="Business name"
            placeholder="Atlas Outfitters"
            error={errors.name?.message}
            {...register('name')}
          />
          <TextField
            label="First store name"
            placeholder="Casablanca flagship"
            hint="You can add more stores later."
            error={errors.storeName?.message}
            {...register('storeName')}
          />
          <div className="grid gap-5 sm:grid-cols-2">
            <SelectField
              label="Currency"
              options={CURRENCY_OPTIONS}
              error={errors.defaultCurrency?.message}
              {...register('defaultCurrency')}
            />
            <SelectField
              label="Time zone"
              options={TIMEZONE_OPTIONS}
              error={errors.timezone?.message}
              {...register('timezone')}
            />
          </div>
          <Button type="submit" className="w-full" loading={create.isPending}>
            <BuildingStorefrontIcon aria-hidden="true" className="size-5" />
            Create organization
          </Button>
        </fieldset>
      </form>
    </AuthLayout>
  );
}
