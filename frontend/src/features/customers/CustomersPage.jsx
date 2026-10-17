import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownTrayIcon, MagnifyingGlassIcon, PlusIcon } from '@heroicons/react/20/solid';
import { UserGroupIcon } from '@heroicons/react/24/outline';
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  PageHeader,
  SkeletonRows,
} from '../../components/ui/layout.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Dialog } from '../../components/ui/Dialog.jsx';
import { TextField } from '../../components/ui/fields.jsx';
import { Pagination } from '../../components/ui/Pagination.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useDebouncedValue } from '../../hooks/useDebouncedValue.js';
import { useServerErrors } from '../../hooks/useServerErrors.js';
import { getApiError } from '../../lib/apiClient.js';
import { formatDate, formatSpent } from '../../lib/format.js';
import { countryName } from '../../lib/locale.js';
import {
  createCustomer,
  downloadCustomerExport,
  listCustomers,
} from '../../services/customerService.js';
import { useHasPermission } from '../auth/useSession.js';

const PAGE_SIZE = 25;
const filterClass =
  'rounded-md border-0 py-2 pl-3 pr-8 text-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-600';

export const customerSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(160, 'Use at most 160 characters'),
  email: z.union([
    z.literal(''),
    z
      .string()
      .trim()
      .pipe(z.email({ error: 'Enter a valid email address' })),
  ]),
  phone: z
    .string()
    .trim()
    .max(40, 'Use at most 40 characters')
    .regex(/^[0-9+()\-.\s]*$/, 'Use digits, spaces and + ( ) - only'),
});

function NewCustomerDialog({ open, onClose }) {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(customerSchema),
    defaultValues: { name: '', email: '', phone: '' },
  });
  const [formError, handleError, clearFormError] = useServerErrors(setError);
  const close = () => {
    reset();
    clearFormError();
    onClose();
  };
  const create = useMutation({
    mutationFn: createCustomer,
    onSuccess: (customer) => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      toast.success(`${customer.name} added.`);
      close();
      navigate(`/customers/${customer.id}`);
    },
    onError: handleError,
  });

  return (
    <Dialog
      open={open}
      onClose={close}
      title="New customer"
      description="Addresses can be added on the customer's page."
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={create.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="customer-form" loading={create.isPending}>
            Add customer
          </Button>
        </>
      }
    >
      <form
        id="customer-form"
        noValidate
        onSubmit={handleSubmit((v) => create.mutate(v))}
        className="space-y-4"
      >
        {formError && <Alert tone="error">{formError}</Alert>}
        <TextField
          label="Name"
          autoComplete="off"
          error={errors.name?.message}
          {...register('name')}
        />
        <TextField
          label="Email"
          type="email"
          autoComplete="off"
          hint="Optional."
          error={errors.email?.message}
          {...register('email')}
        />
        <TextField
          label="Phone"
          type="tel"
          autoComplete="off"
          hint="Optional."
          error={errors.phone?.message}
          {...register('phone')}
        />
      </form>
    </Dialog>
  );
}

export function CustomersPage() {
  const can = useHasPermission();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const filters = {
    search: params.get('search') ?? '',
    status: params.get('status') ?? 'active',
    sort: params.get('sort') ?? 'name',
    page: Math.max(1, Number(params.get('page')) || 1),
  };
  const update = (changes) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries({ page: 1, ...changes })) {
      const isDefault =
        v === '' ||
        (k === 'page' && v === 1) ||
        (k === 'status' && v === 'active') ||
        (k === 'sort' && v === 'name');
      if (isDefault) next.delete(k);
      else next.set(k, String(v));
    }
    setParams(next, { replace: true });
  };
  const [searchInput, setSearchInput] = useState(filters.search);
  const debouncedSearch = useDebouncedValue(searchInput);
  useEffect(() => {
    if (debouncedSearch !== filters.search) update({ search: debouncedSearch });
    // Only react to the debounced text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);
  const [creating, setCreating] = useState(false);

  const customers = useQuery({
    queryKey: ['customers', filters],
    queryFn: () =>
      listCustomers({
        page: filters.page,
        pageSize: PAGE_SIZE,
        status: filters.status,
        sort: filters.sort,
        search: filters.search || undefined,
      }),
    placeholderData: keepPreviousData,
  });
  const exporting = useMutation({
    mutationFn: () =>
      downloadCustomerExport({ status: filters.status, search: filters.search || undefined }),
    onSuccess: (name) => toast.success(`Downloaded ${name}.`),
    onError: (e) => toast.error(getApiError(e).message),
  });

  return (
    <>
      <PageHeader
        title="Customers"
        description="The people and businesses you sell to."
        actions={
          <>
            {can('customer:export') && (
              <Button
                variant="secondary"
                loading={exporting.isPending}
                onClick={() => exporting.mutate()}
              >
                <ArrowDownTrayIcon aria-hidden="true" className="size-4" /> Export CSV
              </Button>
            )}
            {can('customer:write') && (
              <Button onClick={() => setCreating(true)}>
                <PlusIcon aria-hidden="true" className="size-5" /> New customer
              </Button>
            )}
          </>
        }
      />
      <Card>
        <div className="mb-4 flex flex-wrap gap-3">
          <label className="relative min-w-[14rem] flex-1">
            <span className="sr-only">Search customers</span>
            <MagnifyingGlassIcon
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-2.5 size-4 text-slate-400"
            />
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search by name, email or phone"
              className="block w-full rounded-md border-0 py-2 pl-9 pr-3 text-sm shadow-sm ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-600"
            />
          </label>
          <label>
            <span className="sr-only">Status</span>
            <select
              value={filters.status}
              onChange={(e) => update({ status: e.target.value })}
              className={filterClass}
            >
              <option value="active">Active</option>
              <option value="archived">Archived</option>
              <option value="all">All</option>
            </select>
          </label>
          <label>
            <span className="sr-only">Sort by</span>
            <select
              value={filters.sort}
              onChange={(e) => update({ sort: e.target.value })}
              className={filterClass}
            >
              <option value="name">Name (A–Z)</option>
              <option value="-name">Name (Z–A)</option>
              <option value="-createdAt">Newest</option>
              <option value="createdAt">Oldest</option>
            </select>
          </label>
        </div>

        {customers.isPending ? (
          <SkeletonRows rows={5} label="Loading customers" />
        ) : customers.isError ? (
          <Alert
            tone="error"
            action={
              <Button size="sm" variant="secondary" onClick={() => customers.refetch()}>
                Retry
              </Button>
            }
          >
            {getApiError(customers.error).message}
          </Alert>
        ) : customers.data.data.length === 0 ? (
          filters.search || filters.status !== 'active' ? (
            <EmptyState icon={MagnifyingGlassIcon} title="No customers match these filters" />
          ) : (
            <EmptyState
              icon={UserGroupIcon}
              title="No customers yet"
              description="Add customers here, or they will be created as you take orders."
              action={
                can('customer:write') && (
                  <Button onClick={() => setCreating(true)}>New customer</Button>
                )
              }
            />
          )
        ) : (
          <div className={`space-y-4 ${customers.isPlaceholderData ? 'opacity-60' : ''}`}>
            <div className="relative -mx-5 overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                  <tr>
                    <th scope="col" className="px-5 py-3">
                      Customer
                    </th>
                    <th scope="col" className="hidden px-3 py-3 md:table-cell">
                      Phone
                    </th>
                    <th scope="col" className="hidden px-3 py-3 sm:table-cell">
                      Location
                    </th>
                    <th scope="col" className="hidden px-3 py-3 text-right sm:table-cell">
                      Orders
                    </th>
                    <th scope="col" className="px-3 py-3 text-right">
                      Spent
                    </th>
                    <th scope="col" className="hidden px-5 py-3 lg:table-cell">
                      Added
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {customers.data.data.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-50">
                      <td className="px-5 py-3">
                        <Link
                          to={`/customers/${c.id}`}
                          className="font-medium text-slate-900 hover:text-indigo-600"
                        >
                          {c.name}
                        </Link>
                        {c.archived && (
                          <span className="ml-2">
                            <Badge>Archived</Badge>
                          </span>
                        )}
                        <p className="text-xs text-slate-500">{c.email ?? 'No email'}</p>
                      </td>
                      <td className="hidden px-3 py-3 text-slate-600 md:table-cell">
                        {c.phone ?? '—'}
                      </td>
                      <td className="hidden px-3 py-3 text-slate-600 sm:table-cell">
                        {c.location
                          ? `${c.location.city}, ${countryName(c.location.country)}`
                          : '—'}
                      </td>
                      <td className="hidden px-3 py-3 text-right tabular-nums text-slate-600 sm:table-cell">
                        {c.orderCount}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-slate-900">
                        {formatSpent(c.spent)}
                      </td>
                      <td className="hidden px-5 py-3 text-slate-500 lg:table-cell">
                        {formatDate(c.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={customers.data.meta.page}
              pageSize={customers.data.meta.pageSize}
              total={customers.data.meta.total}
              onPageChange={(page) => update({ page })}
            />
          </div>
        )}
      </Card>
      {can('customer:write') && (
        <NewCustomerDialog open={creating} onClose={() => setCreating(false)} />
      )}
    </>
  );
}
