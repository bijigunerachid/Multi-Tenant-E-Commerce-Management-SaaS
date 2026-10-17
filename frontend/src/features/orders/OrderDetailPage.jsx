import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Alert, Badge, Card, PageHeader, SkeletonRows } from '../../components/ui/layout.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { ConfirmDialog, Dialog } from '../../components/ui/Dialog.jsx';
import { TextField } from '../../components/ui/fields.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { getApiError } from '../../lib/apiClient.js';
import { formatMoney } from '../../lib/format.js';
import { countryName } from '../../lib/locale.js';
import {
  cancelOrder,
  deleteOrder,
  getOrder,
  transitionOrder,
} from '../../services/orderService.js';
import { useHasPermission } from '../auth/useSession.js';
import { ACTION_LABELS, ORDER_STATUS, RESERVATION_LABELS, orderTitle } from './orderLabels.js';

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function CancelDialog({ order, onClose }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(
      z.object({ reason: z.string().trim().min(1, 'Give a reason for cancelling').max(500) }),
    ),
    defaultValues: { reason: '' },
  });
  const cancel = useMutation({
    mutationFn: ({ reason }) => cancelOrder(order.id, reason),
    onSuccess: (saved) => {
      queryClient.setQueryData(['order', saved.id], saved);
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      toast.success(`${orderTitle(saved)} cancelled. Reserved stock was released.`);
      onClose();
    },
    onError: (e) => toast.error(getApiError(e).message),
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Cancel ${orderTitle(order)}?`}
      description="Reserved stock goes back to available. Cancelled orders cannot be reopened."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={cancel.isPending}>
            Keep order
          </Button>
          <Button type="submit" form="cancel-form" variant="danger" loading={cancel.isPending}>
            Cancel order
          </Button>
        </>
      }
    >
      <form id="cancel-form" noValidate onSubmit={handleSubmit((v) => cancel.mutate(v))}>
        <TextField
          label="Reason"
          placeholder="For example: customer changed their mind"
          error={errors.reason?.message}
          {...register('reason')}
        />
      </form>
    </Dialog>
  );
}

function Address({ address }) {
  if (!address)
    return <p className="text-sm text-slate-500">No delivery address (collected in store).</p>;
  return (
    <address className="text-sm not-italic leading-relaxed text-slate-700">
      {address.recipientName && (
        <>
          {address.recipientName}
          <br />
        </>
      )}
      {address.line1}
      <br />
      {address.line2 && (
        <>
          {address.line2}
          <br />
        </>
      )}
      {[address.postalCode, address.city].filter(Boolean).join(' ')}
      {address.region && `, ${address.region}`}
      <br />
      {countryName(address.country)}
      {address.phone && (
        <>
          <br />
          {address.phone}
        </>
      )}
    </address>
  );
}

export function OrderDetailPage() {
  const { orderId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const can = useHasPermission();
  const [cancelling, setCancelling] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const order = useQuery({ queryKey: ['order', orderId], queryFn: () => getOrder(orderId) });

  const transition = useMutation({
    mutationFn: (action) => transitionOrder(orderId, action),
    onSuccess: (saved) => {
      queryClient.setQueryData(['order', saved.id], saved);
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      toast.success(
        `${orderTitle(saved)} is now ${ORDER_STATUS[saved.status].label.toLowerCase()}.`,
      );
    },
    onError: (e) => {
      // Stock or status may have changed meanwhile: show the current state.
      queryClient.invalidateQueries({ queryKey: ['order', orderId] });
      toast.error(getApiError(e).message);
    },
  });
  const remove = useMutation({
    mutationFn: () => deleteOrder(orderId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      toast.success('Draft deleted.');
      navigate('/orders', { replace: true });
    },
    onError: (e) => {
      setConfirmDelete(false);
      toast.error(getApiError(e).message);
    },
  });

  if (order.isPending) return <SkeletonRows rows={6} label="Loading order" />;
  if (order.isError) {
    return (
      <Alert
        tone="error"
        action={
          <Link to="/orders" className="text-sm font-medium">
            Back to orders
          </Link>
        }
      >
        {getApiError(order.error).message}
      </Alert>
    );
  }
  const o = order.data;
  const forward = o.allowedActions.filter((a) => a !== 'cancel');
  const canCancel = o.allowedActions.includes('cancel') && can('order:cancel');
  const isDraft = o.status === 'DRAFT';

  return (
    <>
      <PageHeader
        title={orderTitle(o)}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={ORDER_STATUS[o.status].tone}>{ORDER_STATUS[o.status].label}</Badge>
            {o.placedAt
              ? `Placed ${dateTime.format(new Date(o.placedAt))}`
              : `Created ${dateTime.format(new Date(o.createdAt))}`}
          </span>
        }
        actions={
          <>
            {isDraft && can('order:write') && (
              <>
                <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
                  Delete draft
                </Button>
                <Link
                  to={`/orders/${o.id}/edit`}
                  className="inline-flex items-center rounded-md px-3.5 py-2 text-sm font-medium text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50"
                >
                  Edit
                </Link>
              </>
            )}
            {canCancel && (
              <Button variant="secondary" onClick={() => setCancelling(true)}>
                Cancel order
              </Button>
            )}
            {can('order:transition') &&
              forward.map((action) => (
                <Button
                  key={action}
                  loading={transition.isPending && transition.variables === action}
                  disabled={transition.isPending}
                  onClick={() => transition.mutate(action)}
                >
                  {ACTION_LABELS[action]}
                </Button>
              ))}
          </>
        }
      />

      {o.status === 'CANCELLED' && o.cancelReason && (
        <div className="mb-6">
          <Alert tone="warning" title="Cancelled">
            {o.cancelReason}
          </Alert>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3 [&>*]:min-w-0">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Items">
            <div className="relative -mx-5 -my-4 overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                  <tr>
                    <th scope="col" className="px-5 py-3">
                      Product
                    </th>
                    <th scope="col" className="px-3 py-3 text-right">
                      Qty
                    </th>
                    <th scope="col" className="px-3 py-3 text-right">
                      Price
                    </th>
                    <th scope="col" className="px-3 py-3 text-right">
                      Total
                    </th>
                    <th scope="col" className="hidden px-5 py-3 sm:table-cell">
                      Stock
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {o.items.map((i) => (
                    <tr key={i.id}>
                      <td className="px-5 py-3">
                        <p className="font-medium text-slate-900">{i.productName}</p>
                        <p className="text-xs text-slate-500">
                          {i.sku}
                          {i.variantName !== 'Default' && ` · ${i.variantName}`}
                        </p>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">{i.quantity}</td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {formatMoney(i.unitPrice, o.currency)}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums font-medium">
                        {formatMoney(i.lineTotal, o.currency)}
                      </td>
                      <td className="hidden px-5 py-3 text-slate-600 sm:table-cell">
                        {i.reservation ? RESERVATION_LABELS[i.reservation] : 'Not reserved'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="History">
            {o.history.length === 0 ? (
              <p className="text-sm text-slate-500">This draft has not been placed yet.</p>
            ) : (
              <ol className="space-y-4">
                {o.history.map((h, idx) => (
                  <li key={idx} className="flex gap-3 text-sm">
                    <span
                      aria-hidden="true"
                      className="mt-1.5 size-2 shrink-0 rounded-full bg-indigo-500"
                    />
                    <div>
                      <p className="text-slate-900">
                        <span className="font-medium">{ORDER_STATUS[h.toStatus].label}</span>
                        {h.actor?.name && (
                          <span className="text-slate-600"> by {h.actor.name}</span>
                        )}
                      </p>
                      <p className="text-xs text-slate-500">
                        {dateTime.format(new Date(h.createdAt))}
                      </p>
                      {h.note && <p className="mt-1 text-slate-600">{h.note}</p>}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Summary">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-600">Subtotal</dt>
                <dd className="tabular-nums">{formatMoney(o.subtotal, o.currency)}</dd>
              </div>
              {Number(o.discountTotal) > 0 && (
                <div className="flex justify-between">
                  <dt className="text-slate-600">Discount</dt>
                  <dd className="tabular-nums">−{formatMoney(o.discountTotal, o.currency)}</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-slate-600">
                  Tax{Number(o.taxRate) > 0 && ` (${Number(o.taxRate) * 100}%)`}
                </dt>
                <dd className="tabular-nums">{formatMoney(o.taxTotal, o.currency)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-600">Shipping</dt>
                <dd className="tabular-nums">{formatMoney(o.shippingTotal, o.currency)}</dd>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-semibold">
                <dt>Total</dt>
                <dd className="tabular-nums">{formatMoney(o.total, o.currency)}</dd>
              </div>
            </dl>
          </Card>
          <Card title="Customer">
            {o.customer ? (
              <div className="text-sm">
                {can('customer:read') ? (
                  <Link
                    to={`/customers/${o.customer.id}`}
                    className="font-medium text-slate-900 hover:text-indigo-600"
                  >
                    {o.customer.name}
                  </Link>
                ) : (
                  <p className="font-medium text-slate-900">{o.customer.name}</p>
                )}
                <p className="text-slate-500">{o.customer.email ?? 'No email'}</p>
              </div>
            ) : (
              <p className="text-sm text-slate-500">No customer on this order.</p>
            )}
            <h3 className="mb-1 mt-4 text-sm font-medium text-slate-800">Delivery</h3>
            <Address address={o.shippingAddress} />
            <p className="mt-3 text-xs text-slate-500">Fulfilled from {o.store.name}</p>
          </Card>
          {o.notes && (
            <Card title="Notes">
              <p className="whitespace-pre-line text-sm text-slate-700">{o.notes}</p>
            </Card>
          )}
        </div>
      </div>

      {cancelling && <CancelDialog order={o} onClose={() => setCancelling(false)} />}
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => remove.mutate()}
        loading={remove.isPending}
        title="Delete this draft?"
        confirmLabel="Delete draft"
      >
        The draft is removed. No stock was reserved for it.
      </ConfirmDialog>
    </>
  );
}
