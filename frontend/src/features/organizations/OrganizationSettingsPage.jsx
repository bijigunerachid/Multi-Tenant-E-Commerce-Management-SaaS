import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Card, PageHeader, SkeletonRows } from '../../components/ui/layout.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { ConfirmDialog, Dialog } from '../../components/ui/Dialog.jsx';
import { SelectField, TextField } from '../../components/ui/fields.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useServerErrors } from '../../hooks/useServerErrors.js';
import { getApiError } from '../../lib/apiClient.js';
import { CURRENCY_OPTIONS, TIMEZONE_OPTIONS } from '../../lib/locale.js';
import { ROLE_LABELS } from '../../lib/roles.js';
import {
  acceptOwnershipTransfer,
  cancelOwnershipTransfer,
  getCurrentOrganization,
  getOwnershipTransfer,
  startOwnershipTransfer,
  updateOrganization,
} from '../../services/organizationService.js';
import { listMembers } from '../../services/memberService.js';
import { nameField } from '../auth/schemas.js';
import { StoresCard } from './StoresCard.jsx';
import { SESSION_KEY, useApplySession, useHasPermission, useSession } from '../auth/useSession.js';

const settingsSchema = z.object({
  name: nameField,
  defaultCurrency: z.string().min(1),
  timezone: z.string().min(1),
  contactEmail: z.union([
    z.literal(''),
    z
      .string()
      .trim()
      .pipe(z.email({ error: 'Enter a valid email address' })),
  ]),
  contactPhone: z
    .string()
    .trim()
    .max(40, 'Use at most 40 characters')
    .regex(/^[0-9+()\-.\s]*$/, 'Use digits, spaces and + ( ) - only'),
});

function SettingsForm({ org, editable }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isDirty },
  } = useForm({
    resolver: zodResolver(settingsSchema),
    values: {
      name: org.name,
      defaultCurrency: org.defaultCurrency,
      timezone: org.timezone,
      contactEmail: org.contactEmail ?? '',
      contactPhone: org.contactPhone ?? '',
    },
  });
  const [formError, handleError] = useServerErrors(setError);
  const save = useMutation({
    mutationFn: updateOrganization,
    onSuccess: (updated) => {
      queryClient.setQueryData(['organization'], updated);
      queryClient.invalidateQueries({ queryKey: SESSION_KEY });
      reset();
      toast.success('Organization settings saved.');
    },
    onError: handleError,
  });

  return (
    <form noValidate onSubmit={handleSubmit((v) => save.mutate(v))} className="space-y-5">
      {formError && <Alert tone="error">{formError}</Alert>}
      {!editable && <Alert tone="info">Only owners can change these settings.</Alert>}
      <fieldset disabled={!editable} className="grid gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <TextField label="Organization name" error={errors.name?.message} {...register('name')} />
        </div>
        <TextField
          label="Address"
          value={org.slug}
          readOnly
          disabled
          hint="The organization address cannot be changed."
        />
        <div />
        <SelectField
          label="Default currency"
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
        <TextField
          label="Contact email"
          type="email"
          autoComplete="off"
          error={errors.contactEmail?.message}
          {...register('contactEmail')}
        />
        <TextField
          label="Contact phone"
          type="tel"
          error={errors.contactPhone?.message}
          {...register('contactPhone')}
        />
      </fieldset>
      {editable && (
        <div className="flex justify-end">
          <Button type="submit" loading={save.isPending} disabled={!isDirty}>
            Save changes
          </Button>
        </div>
      )}
    </form>
  );
}

function OwnershipTransferCard() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const applySession = useApplySession();
  const { data: session } = useSession();
  const can = useHasPermission();
  const isOwner = can('org:transfer_ownership');
  const [starting, setStarting] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const transfer = useQuery({ queryKey: ['ownership-transfer'], queryFn: getOwnershipTransfer });
  const members = useQuery({
    queryKey: ['members'],
    queryFn: listMembers,
    enabled: isOwner && starting,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['ownership-transfer'] });

  const form = useForm({ defaultValues: { toMembershipId: '', password: '' } });
  const [formError, handleError, clearFormError] = useServerErrors(form.setError);
  const closeStart = () => {
    form.reset();
    clearFormError();
    setStarting(false);
  };

  const start = useMutation({
    mutationFn: startOwnershipTransfer,
    onSuccess: () => {
      refresh();
      closeStart();
      toast.success('Ownership transfer started. The new owner has been emailed.');
    },
    onError: handleError,
  });
  const cancel = useMutation({
    mutationFn: cancelOwnershipTransfer,
    onSuccess: () => {
      refresh();
      setConfirmCancel(false);
      toast.success('Ownership transfer cancelled.');
    },
    onError: (e) => toast.error(getApiError(e).message),
  });
  const accept = useMutation({
    mutationFn: acceptOwnershipTransfer,
    onSuccess: (s) => {
      applySession(s);
      queryClient.invalidateQueries();
      toast.success('You are now the owner of this organization.');
    },
    onError: (e) => {
      refresh();
      toast.error(getApiError(e).message);
    },
  });

  if (transfer.isPending)
    return (
      <Card title="Ownership">
        <SkeletonRows rows={1} label="Loading ownership" />
      </Card>
    );
  if (transfer.isError)
    return (
      <Card title="Ownership">
        <Alert tone="error">{getApiError(transfer.error).message}</Alert>
      </Card>
    );

  const pending = transfer.data;
  const isTarget = pending && pending.to.membershipId === session.activeOrganization.membershipId;
  const candidates = (members.data ?? []).filter(
    (m) => m.status === 'ACTIVE' && m.role !== 'OWNER',
  );

  return (
    <Card
      title="Ownership"
      description="Each organization has one owner, who manages the team, billing and these settings."
    >
      {pending ? (
        <Alert
          tone="warning"
          title={`${pending.from.name} is transferring ownership to ${pending.to.name}`}
          action={
            isTarget ? (
              <Button size="sm" loading={accept.isPending} onClick={() => accept.mutate()}>
                Accept ownership
              </Button>
            ) : isOwner ? (
              <Button size="sm" variant="secondary" onClick={() => setConfirmCancel(true)}>
                Cancel transfer
              </Button>
            ) : null
          }
        >
          {isTarget
            ? 'If you accept, you become the owner and the current owner becomes a store manager.'
            : `Waiting for ${pending.to.name} to accept. The request expires ${new Date(pending.expiresAt).toLocaleString()}.`}
        </Alert>
      ) : isOwner ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-600">
            Hand the organization over to another active member. You will become a store manager.
          </p>
          <Button variant="secondary" onClick={() => setStarting(true)}>
            Transfer ownership
          </Button>
        </div>
      ) : (
        <p className="text-sm text-ink-600">No ownership transfer is pending.</p>
      )}

      <Dialog
        open={starting}
        onClose={closeStart}
        title="Transfer ownership"
        description="The member must accept within 72 hours. Until then, nothing changes."
        footer={
          <>
            <Button variant="secondary" onClick={closeStart} disabled={start.isPending}>
              Cancel
            </Button>
            <Button type="submit" form="transfer-form" variant="danger" loading={start.isPending}>
              Start transfer
            </Button>
          </>
        }
      >
        <form
          id="transfer-form"
          noValidate
          onSubmit={form.handleSubmit((v) => {
            if (!v.toMembershipId)
              return form.setError('toMembershipId', { message: 'Choose the new owner' });
            if (!v.password) return form.setError('password', { message: 'Enter your password' });
            start.mutate(v);
          })}
          className="space-y-4"
        >
          {formError && <Alert tone="error">{formError}</Alert>}
          {members.isPending ? (
            <SkeletonRows rows={1} label="Loading members" />
          ) : candidates.length === 0 ? (
            <Alert tone="info">Invite or reactivate another member first.</Alert>
          ) : (
            <SelectField
              label="New owner"
              placeholder="Choose a member"
              options={candidates.map((m) => ({
                value: m.id,
                label: `${m.name} (${ROLE_LABELS[m.role]})`,
              }))}
              error={form.formState.errors.toMembershipId?.message}
              {...form.register('toMembershipId')}
            />
          )}
          <TextField
            label="Your password"
            type="password"
            autoComplete="current-password"
            hint="Confirms that it is really you."
            error={form.formState.errors.password?.message}
            {...form.register('password')}
          />
        </form>
      </Dialog>
      <ConfirmDialog
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        onConfirm={() => cancel.mutate()}
        loading={cancel.isPending}
        title="Cancel the ownership transfer?"
        confirmLabel="Cancel transfer"
      >
        {pending?.to.name} will no longer be able to accept it.
      </ConfirmDialog>
    </Card>
  );
}

export function OrganizationSettingsPage() {
  const can = useHasPermission();
  const org = useQuery({ queryKey: ['organization'], queryFn: getCurrentOrganization });

  return (
    <>
      <PageHeader title="Organization settings" />
      <div className="space-y-6">
        <Card title="Details">
          {org.isPending ? (
            <SkeletonRows rows={4} label="Loading organization" />
          ) : org.isError ? (
            <Alert
              tone="error"
              action={
                <Button size="sm" variant="secondary" onClick={() => org.refetch()}>
                  Retry
                </Button>
              }
            >
              {getApiError(org.error).message}
            </Alert>
          ) : (
            <SettingsForm org={org.data} editable={can('org:update')} />
          )}
        </Card>
        <StoresCard />
        <OwnershipTransferCard />
      </div>
    </>
  );
}
