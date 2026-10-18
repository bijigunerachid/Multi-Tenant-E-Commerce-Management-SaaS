import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PlusIcon } from '@heroicons/react/20/solid';
import { MapPinIcon } from '@heroicons/react/24/outline';
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  PageHeader,
  SkeletonRows,
} from '../../components/ui/layout.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { ConfirmDialog, Dialog } from '../../components/ui/Dialog.jsx';
import { SelectField, TextField } from '../../components/ui/fields.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useServerErrors } from '../../hooks/useServerErrors.js';
import { getApiError } from '../../lib/apiClient.js';
import { formatDate } from '../../lib/format.js';
import { COUNTRY_OPTIONS, countryName } from '../../lib/locale.js';
import {
  addAddress,
  deleteAddress,
  deleteCustomer,
  getCustomer,
  setCustomerArchived,
  updateAddress,
  updateCustomer,
} from '../../services/customerService.js';
import { useHasPermission } from '../auth/useSession.js';
import { customerSchema } from './CustomersPage.jsx';
import { CustomerStats, RecentOrders } from './CustomerOrders.jsx';

const profileSchema = customerSchema.extend({
  notes: z.string().max(2000, 'Use at most 2000 characters'),
});

const addressSchema = z.object({
  label: z.string().trim().max(60, 'Use at most 60 characters'),
  recipientName: z.string().trim().max(160, 'Use at most 160 characters'),
  line1: z.string().trim().min(1, 'Enter the street address').max(200),
  line2: z.string().trim().max(200),
  city: z.string().trim().min(1, 'Enter a city').max(120),
  region: z.string().trim().max(120),
  postalCode: z.string().trim().max(20, 'Use at most 20 characters'),
  country: z.string().min(1, 'Choose a country'),
  phone: z
    .string()
    .trim()
    .max(40)
    .regex(/^[0-9+()\-.\s]*$/, 'Use digits, spaces and + ( ) - only'),
});

const blankToNull = (values) =>
  Object.fromEntries(
    Object.entries(values).map(([k, v]) => [
      k,
      typeof v === 'string' && v.trim() === '' ? null : v,
    ]),
  );

function ProfileCard({ customer, editable }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isDirty },
  } = useForm({
    resolver: zodResolver(profileSchema),
    values: {
      name: customer.name,
      email: customer.email ?? '',
      phone: customer.phone ?? '',
      notes: customer.notes ?? '',
    },
  });
  const [formError, handleError] = useServerErrors(setError);
  const save = useMutation({
    mutationFn: (v) => updateCustomer(customer.id, { ...blankToNull(v), name: v.name }),
    onSuccess: (saved) => {
      queryClient.setQueryData(['customer', saved.id], saved);
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      reset();
      toast.success('Customer saved.');
    },
    onError: handleError,
  });

  return (
    <Card title="Profile">
      <form noValidate onSubmit={handleSubmit((v) => save.mutate(v))} className="space-y-5">
        {formError && <Alert tone="error">{formError}</Alert>}
        <fieldset disabled={!editable} className="grid gap-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <TextField label="Name" error={errors.name?.message} {...register('name')} />
          </div>
          <TextField
            label="Email"
            type="email"
            autoComplete="off"
            error={errors.email?.message}
            {...register('email')}
          />
          <TextField
            label="Phone"
            type="tel"
            error={errors.phone?.message}
            {...register('phone')}
          />
          <div className="sm:col-span-2">
            <label htmlFor="customer-notes" className="block text-sm font-medium text-ink-800">
              Notes <span className="font-normal text-ink-500">(visible to your team only)</span>
            </label>
            <textarea
              id="customer-notes"
              rows={3}
              className="mt-1.5 block w-full rounded-md border-0 px-3 py-2 text-sm ring-1 ring-inset ring-ink-300 focus:ring-2 focus:ring-inset focus:ring-brand-600 disabled:bg-ink-50"
              {...register('notes')}
            />
            {errors.notes && <p className="mt-1.5 text-sm text-red-600">{errors.notes.message}</p>}
          </div>
        </fieldset>
        {editable && (
          <div className="flex justify-end">
            <Button type="submit" loading={save.isPending} disabled={!isDirty}>
              Save changes
            </Button>
          </div>
        )}
      </form>
    </Card>
  );
}

function AddressDialog({ customerId, address, onClose }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(addressSchema),
    defaultValues: {
      label: address?.label ?? '',
      recipientName: address?.recipientName ?? '',
      line1: address?.line1 ?? '',
      line2: address?.line2 ?? '',
      city: address?.city ?? '',
      region: address?.region ?? '',
      postalCode: address?.postalCode ?? '',
      country: address?.country ?? '',
      phone: address?.phone ?? '',
    },
  });
  const [formError, handleError] = useServerErrors(setError);
  const save = useMutation({
    mutationFn: (v) => {
      const body = blankToNull(v);
      return address ? updateAddress(customerId, address.id, body) : addAddress(customerId, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customer', customerId] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      toast.success(address ? 'Address saved.' : 'Address added.');
      onClose();
    },
    onError: handleError,
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title={address ? 'Edit address' : 'Add address'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="address-form" loading={save.isPending}>
            {address ? 'Save address' : 'Add address'}
          </Button>
        </>
      }
    >
      <form
        id="address-form"
        noValidate
        onSubmit={handleSubmit((v) => save.mutate(v))}
        className="grid gap-4 sm:grid-cols-2"
      >
        {formError && (
          <div className="sm:col-span-2">
            <Alert tone="error">{formError}</Alert>
          </div>
        )}
        <TextField
          label="Label"
          placeholder="Home, Office…"
          hint="Optional."
          error={errors.label?.message}
          {...register('label')}
        />
        <TextField
          label="Recipient"
          hint="If different from the customer."
          error={errors.recipientName?.message}
          {...register('recipientName')}
        />
        <div className="sm:col-span-2">
          <TextField
            label="Street address"
            autoComplete="off"
            error={errors.line1?.message}
            {...register('line1')}
          />
        </div>
        <div className="sm:col-span-2">
          <TextField
            label="Apartment, suite, etc."
            hint="Optional."
            error={errors.line2?.message}
            {...register('line2')}
          />
        </div>
        <TextField label="City" error={errors.city?.message} {...register('city')} />
        <TextField
          label="Region / state"
          hint="Optional."
          error={errors.region?.message}
          {...register('region')}
        />
        <TextField
          label="Postal code"
          error={errors.postalCode?.message}
          {...register('postalCode')}
        />
        <SelectField
          label="Country"
          placeholder="Choose a country"
          options={COUNTRY_OPTIONS}
          error={errors.country?.message}
          {...register('country')}
        />
        <TextField
          label="Phone for delivery"
          type="tel"
          hint="Optional."
          error={errors.phone?.message}
          {...register('phone')}
        />
      </form>
    </Dialog>
  );
}

function AddressesCard({ customer, editable }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(null); // null | 'new' | address
  const [removing, setRemoving] = useState(null);
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['customer', customer.id] });
    queryClient.invalidateQueries({ queryKey: ['customers'] });
  };
  const makeDefault = useMutation({
    mutationFn: (a) => updateAddress(customer.id, a.id, { isDefault: true }),
    onSuccess: () => {
      refresh();
      toast.success('Default address changed.');
    },
    onError: (e) => toast.error(getApiError(e).message),
  });
  const remove = useMutation({
    mutationFn: (a) => deleteAddress(customer.id, a.id),
    onSuccess: () => {
      refresh();
      setRemoving(null);
      toast.success('Address removed.');
    },
    onError: (e) => toast.error(getApiError(e).message),
  });

  return (
    <Card
      title="Addresses"
      actions={
        editable && (
          <Button size="sm" variant="secondary" onClick={() => setEditing('new')}>
            <PlusIcon aria-hidden="true" className="size-4" /> Add address
          </Button>
        )
      }
    >
      {customer.addresses.length === 0 ? (
        <EmptyState icon={MapPinIcon} title="No addresses yet" />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {customer.addresses.map((a) => (
            <li key={a.id} className="rounded-md border border-ink-200 p-4 text-sm">
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium text-ink-900">{a.label ?? 'Address'}</p>
                {a.isDefault && <Badge tone="accent">Default</Badge>}
              </div>
              <address className="mt-2 not-italic leading-relaxed text-ink-600">
                {a.recipientName && (
                  <>
                    {a.recipientName}
                    <br />
                  </>
                )}
                {a.line1}
                <br />
                {a.line2 && (
                  <>
                    {a.line2}
                    <br />
                  </>
                )}
                {[a.postalCode, a.city].filter(Boolean).join(' ')}
                {a.region && `, ${a.region}`}
                <br />
                {countryName(a.country)}
                {a.phone && (
                  <>
                    <br />
                    {a.phone}
                  </>
                )}
              </address>
              {editable && (
                <div className="mt-3 flex flex-wrap gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditing(a)}
                    aria-label={`Edit ${a.label ?? 'address'} ${a.line1}`}
                  >
                    Edit
                  </Button>
                  {!a.isDefault && (
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={makeDefault.isPending && makeDefault.variables?.id === a.id}
                      onClick={() => makeDefault.mutate(a)}
                    >
                      Make default
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setRemoving(a)}
                    aria-label={`Remove ${a.label ?? 'address'} ${a.line1}`}
                  >
                    Remove
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <AddressDialog
          customerId={customer.id}
          address={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
      <ConfirmDialog
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        onConfirm={() => remove.mutate(removing)}
        loading={remove.isPending}
        title="Remove this address?"
        confirmLabel="Remove address"
      >
        {removing?.isDefault && customer.addresses.length > 1
          ? 'This is the default address. The oldest remaining address becomes the default.'
          : 'The address is removed from this customer.'}
      </ConfirmDialog>
    </Card>
  );
}

export function CustomerDetailPage() {
  const { customerId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const can = useHasPermission();
  const editable = can('customer:write');
  const canOrder = can('order:write');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const customer = useQuery({
    queryKey: ['customer', customerId],
    queryFn: () => getCustomer(customerId),
  });

  const archive = useMutation({
    mutationFn: (archived) => setCustomerArchived(customerId, archived),
    onSuccess: (saved) => {
      queryClient.setQueryData(['customer', saved.id], saved);
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      toast.success(saved.archived ? 'Customer archived.' : 'Customer restored.');
    },
    onError: (e) => toast.error(getApiError(e).message),
  });
  const remove = useMutation({
    mutationFn: () => deleteCustomer(customerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      toast.success('Customer deleted.');
      navigate('/customers', { replace: true });
    },
    onError: (e) => {
      setConfirmDelete(false);
      toast.error(getApiError(e).message);
    },
  });

  if (customer.isPending) return <SkeletonRows rows={6} label="Loading customer" />;
  if (customer.isError) {
    return (
      <Alert
        tone="error"
        action={
          <Link to="/customers" className="text-sm font-medium">
            Back to customers
          </Link>
        }
      >
        {getApiError(customer.error).message}
      </Alert>
    );
  }
  const c = customer.data;

  return (
    <>
      <PageHeader
        title={c.name}
        description={
          <>
            Customer since {formatDate(c.createdAt)}
            {c.archived && (
              <span className="ml-2">
                <Badge>Archived</Badge>
              </span>
            )}
          </>
        }
        actions={
          (editable || canOrder) && (
            <>
              {canOrder && !c.archived && (
                <Link
                  to={`/orders/new?customerId=${c.id}`}
                  className="inline-flex items-center rounded-md bg-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
                >
                  New order
                </Link>
              )}
              {editable && (
                <>
                  <Button
                    variant="secondary"
                    loading={archive.isPending}
                    onClick={() => archive.mutate(!c.archived)}
                  >
                    {c.archived ? 'Restore' : 'Archive'}
                  </Button>
                  <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                    Delete
                  </Button>
                </>
              )}
            </>
          )
        }
      />
      <div className="space-y-6">
        <CustomerStats stats={c.stats} />
        {can('order:read') && <RecentOrders customer={c} />}
        <ProfileCard key={c.id} customer={c} editable={editable} />
        <AddressesCard customer={c} editable={editable} />
      </div>
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => remove.mutate()}
        loading={remove.isPending}
        title={`Delete ${c.name}?`}
        confirmLabel="Delete customer"
      >
        The customer and their addresses are deleted permanently. Customers with orders cannot be
        deleted; archive them instead.
      </ConfirmDialog>
    </>
  );
}
