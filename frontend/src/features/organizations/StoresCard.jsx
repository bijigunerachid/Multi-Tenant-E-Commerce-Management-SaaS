import { useState } from 'react';
import { Link } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PlusIcon } from '@heroicons/react/20/solid';
import { Alert, Badge, Card, SkeletonRows } from '../../components/ui/layout.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { ConfirmDialog, Dialog } from '../../components/ui/Dialog.jsx';
import { SelectField, TextField } from '../../components/ui/fields.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useServerErrors } from '../../hooks/useServerErrors.js';
import { getApiError } from '../../lib/apiClient.js';
import { CURRENCY_OPTIONS, TIMEZONE_OPTIONS, browserTimeZone } from '../../lib/locale.js';
import {
  archiveStore,
  createStore,
  listStores,
  restoreStore,
  updateStore,
} from '../../services/organizationService.js';
import { useHasPermission, useSession } from '../auth/useSession.js';

const storeSchema = z.object({
  name: z.string().trim().min(1, 'Enter a store name').max(120, 'Use at most 120 characters'),
  currency: z.string().min(1, 'Choose a currency'),
  timezone: z.string().min(1, 'Choose a time zone'),
});

/** Adds a store, or edits one (`store` given). The currency is fixed once the store exists. */
function StoreDialog({ open, store, onClose }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const canSeeBilling = useHasPermission()('billing:read');
  const editing = Boolean(store);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm({
    // A disabled field is not submitted, so the fixed currency is not validated when editing.
    resolver: zodResolver(editing ? storeSchema.omit({ currency: true }) : storeSchema),
    values: store
      ? { name: store.name, currency: store.currency, timezone: store.timezone }
      : {
          name: '',
          currency: session.activeOrganization.defaultCurrency ?? 'USD',
          timezone: browserTimeZone(),
        },
  });
  const [formError, handleError, clearFormError] = useServerErrors(setError);
  const [limitReached, setLimitReached] = useState(false);
  const save = useMutation({
    mutationFn: (values) =>
      editing
        ? updateStore(store.id, { name: values.name, timezone: values.timezone })
        : createStore(values),
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ['stores'] });
      queryClient.invalidateQueries({ queryKey: ['subscription'] });
      toast.success(editing ? 'Store saved.' : `${saved.name} added.`);
      onClose();
    },
    onError: (e) => {
      setLimitReached(getApiError(e).code === 'PLAN_LIMIT_REACHED');
      handleError(e);
    },
  });
  const close = () => {
    clearFormError();
    setLimitReached(false);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title={editing ? 'Edit store' : 'Add a store'}
      description={
        editing
          ? 'The currency cannot change: orders and stock values are recorded in it.'
          : 'Each store has its own stock and orders.'
      }
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="store-form" loading={save.isPending}>
            {editing ? 'Save' : 'Add store'}
          </Button>
        </>
      }
    >
      <form
        id="store-form"
        noValidate
        onSubmit={handleSubmit((v) => save.mutate(v))}
        className="space-y-4"
      >
        {formError && (
          <Alert tone="error">
            {formError}
            {limitReached && canSeeBilling && (
              <>
                {' '}
                <Link to="/settings/billing" className="font-medium underline" onClick={close}>
                  See plans
                </Link>
              </>
            )}
          </Alert>
        )}
        <TextField label="Store name" error={errors.name?.message} {...register('name')} />
        <SelectField
          label="Currency"
          options={CURRENCY_OPTIONS}
          disabled={editing}
          error={errors.currency?.message}
          {...register('currency')}
        />
        <SelectField
          label="Time zone"
          options={TIMEZONE_OPTIONS}
          error={errors.timezone?.message}
          {...register('timezone')}
        />
      </form>
    </Dialog>
  );
}

/** The organization's stores. Owners (org:update) add, edit, archive and restore them. */
export function StoresCard() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const canManage = useHasPermission()('org:update');
  const stores = useQuery({ queryKey: ['stores'], queryFn: listStores });
  const [editing, setEditing] = useState(null); // null: closed; {}: new store; store: edit
  const [archiving, setArchiving] = useState(null);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['stores'] });
    queryClient.invalidateQueries({ queryKey: ['subscription'] });
  };
  const archive = useMutation({
    mutationFn: (id) => archiveStore(id),
    onSuccess: (s) => {
      refresh();
      setArchiving(null);
      toast.success(`${s.name} archived.`);
    },
    onError: (e) => {
      setArchiving(null);
      toast.error(getApiError(e).message);
    },
  });
  const restore = useMutation({
    mutationFn: (id) => restoreStore(id),
    onSuccess: (s) => {
      refresh();
      toast.success(`${s.name} restored.`);
    },
    onError: (e) => toast.error(getApiError(e).message),
  });

  return (
    <Card
      title="Stores"
      description="Inventory and orders are tracked per store."
      actions={
        canManage && (
          <Button size="sm" variant="secondary" onClick={() => setEditing({})}>
            <PlusIcon aria-hidden="true" className="size-4" />
            Add store
          </Button>
        )
      }
    >
      {stores.isPending ? (
        <SkeletonRows rows={1} label="Loading stores" />
      ) : stores.isError ? (
        <Alert
          tone="error"
          action={
            <Button size="sm" variant="secondary" onClick={() => stores.refetch()}>
              Retry
            </Button>
          }
        >
          {getApiError(stores.error).message}
        </Alert>
      ) : (
        <ul className="divide-y divide-slate-100">
          {stores.data.map((s) => (
            <li
              key={s.id}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2.5 text-sm"
            >
              <span className="min-w-0 break-words font-medium text-slate-900">{s.name}</span>
              <span className="flex flex-wrap items-center gap-2 text-slate-500">
                {s.currency} · {s.timezone.replaceAll('_', ' ')}
                <Badge tone={s.status === 'ACTIVE' ? 'success' : 'neutral'}>
                  {s.status === 'ACTIVE' ? 'Active' : 'Archived'}
                </Badge>
                {canManage && (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditing(s)}
                      aria-label={`Edit ${s.name}`}
                    >
                      Edit
                    </Button>
                    {s.status === 'ACTIVE' ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setArchiving(s)}
                        aria-label={`Archive ${s.name}`}
                      >
                        Archive
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={restore.isPending && restore.variables === s.id}
                        onClick={() => restore.mutate(s.id)}
                        aria-label={`Restore ${s.name}`}
                      >
                        Restore
                      </Button>
                    )}
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <StoreDialog
          open={editing !== null}
          store={editing?.id ? editing : null}
          onClose={() => setEditing(null)}
        />
      )}
      <ConfirmDialog
        open={archiving !== null}
        onClose={() => setArchiving(null)}
        onConfirm={() => archive.mutate(archiving.id)}
        loading={archive.isPending}
        title={`Archive ${archiving?.name ?? 'store'}?`}
        confirmLabel="Archive store"
      >
        Its orders and stock history stay visible, but it takes no new stock or orders until it is
        restored. A store with open orders, drafts included, cannot be archived.
      </ConfirmDialog>
    </Card>
  );
}
