import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TrashIcon, XMarkIcon } from '@heroicons/react/20/solid';
import { Alert, Card, PageHeader, SkeletonRows } from '../../components/ui/layout.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { SelectField, TextField } from '../../components/ui/fields.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { getApiError } from '../../lib/apiClient.js';
import { formatMoney } from '../../lib/format.js';
import { countryName } from '../../lib/locale.js';
import { listStores } from '../../services/organizationService.js';
import { getCustomer } from '../../services/customerService.js';
import {
  createOrder,
  getOrder,
  transitionOrder,
  updateOrder,
} from '../../services/orderService.js';
import { CustomerPicker, ProductPicker } from './pickers.jsx';
import { Sku } from '../../components/ui/Sku.jsx';
import { useUnsavedChanges } from '../../hooks/useUnsavedChanges.jsx';
import { previewTotals } from './orderLabels.js';

const MONEY = /^\d{1,10}(\.\d{1,2})?$/;
// Select value meaning "keep the address already copied onto this draft".
const KEEP = '__keep__';

function initialState(order, initialCustomer) {
  if (!order) {
    return {
      storeId: '',
      customer: initialCustomer
        ? { id: initialCustomer.id, name: initialCustomer.name, email: initialCustomer.email }
        : null,
      shippingAddressId: '',
      keptAddress: null,
      addressChosen: false,
      lines: [],
      discountTotal: '',
      shippingTotal: '',
      taxPercent: '',
      notes: '',
    };
  }
  return {
    storeId: order.store.id,
    customer: order.customer,
    // A draft stores a copy of its address, not a link: keep that copy unless the user changes it.
    shippingAddressId: order.shippingAddress ? KEEP : '',
    keptAddress: order.shippingAddress,
    addressChosen: true,
    lines: order.items.map((i) => ({
      variantId: i.variantId,
      sku: i.sku,
      productName: i.productName,
      variantName: i.variantName,
      unitPrice: i.unitPrice,
      currency: order.currency,
      available: null,
      quantity: String(i.quantity),
    })),
    discountTotal: order.discountTotal === '0.00' ? '' : order.discountTotal,
    shippingTotal: order.shippingTotal === '0.00' ? '' : order.shippingTotal,
    taxPercent: Number(order.taxRate) ? String(Number(order.taxRate) * 100) : '',
    notes: order.notes ?? '',
  };
}

function validate(state) {
  const errors = {};
  if (state.lines.length === 0) errors.items = 'Add at least one product';
  state.lines.forEach((l, i) => {
    if (!/^\d{1,6}$/.test(l.quantity) || Number(l.quantity) < 1)
      errors[`items.${i}.quantity`] = 'Enter a whole number of at least 1';
  });
  for (const field of ['discountTotal', 'shippingTotal']) {
    if (state[field] && !MONEY.test(state[field])) errors[field] = 'Enter an amount like 19.90';
  }
  if (
    state.taxPercent &&
    !(/^\d{1,3}(\.\d{1,2})?$/.test(state.taxPercent) && Number(state.taxPercent) <= 100)
  ) {
    errors.taxRate = 'Enter a percentage between 0 and 100';
  }
  return errors;
}

function toBody(state) {
  return {
    storeId: state.storeId || undefined,
    customerId: state.customer?.id ?? null,
    shippingAddressId:
      state.customer && state.shippingAddressId && state.shippingAddressId !== KEEP
        ? state.shippingAddressId
        : null,
    shippingAddress: state.shippingAddressId === KEEP ? state.keptAddress : null,
    items: state.lines.map((l) => ({ variantId: l.variantId, quantity: Number(l.quantity) })),
    discountTotal: state.discountTotal || '0',
    shippingTotal: state.shippingTotal || '0',
    taxRate: state.taxPercent ? String(Number((Number(state.taxPercent) / 100).toFixed(4))) : '0',
    notes: state.notes.trim() || null,
  };
}

function OrderForm({ order, initialCustomer }) {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [state, setState] = useState(() => initialState(order, initialCustomer));
  // Anything different from what the form opened with is unsaved work.
  const [initial] = useState(() => JSON.stringify(initialState(order, initialCustomer)));
  const { prompt, allowNavigation } = useUnsavedChanges(JSON.stringify(state) !== initial);
  const [savedId, setSavedId] = useState(order?.id ?? null);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const set = (changes) => setState((s) => ({ ...s, ...changes }));

  const stores = useQuery({ queryKey: ['stores'], queryFn: listStores });
  const activeStores = (stores.data ?? []).filter((s) => s.status === 'ACTIVE');
  const customerDetail = useQuery({
    queryKey: ['customer', state.customer?.id],
    queryFn: () => getCustomer(state.customer.id),
    enabled: Boolean(state.customer?.id),
  });
  const currency = state.lines[0]?.currency ?? order?.currency ?? null;
  const totals = previewTotals({ ...state, lines: state.lines });

  const save = useMutation({
    mutationFn: async ({ place }) => {
      const body = toBody(state);
      let saved = savedId ? await updateOrder(savedId, body) : await createOrder(body);
      // From now on this form updates the draft that exists, even if placing fails below.
      if (!savedId) setSavedId(saved.id);
      if (place) saved = await transitionOrder(saved.id, 'place');
      return { saved, place };
    },
    onSuccess: ({ saved, place }) => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.setQueryData(['order', saved.id], saved);
      toast.success(place ? `Order #${saved.number} placed. Stock is reserved.` : 'Draft saved.');
      allowNavigation();
      navigate(`/orders/${saved.id}`, { replace: true });
    },
    onError: (e) => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      const apiError = getApiError(e);
      setErrors(apiError.details?.fieldErrors ?? {});
      setFormError(apiError.message);
    },
  });

  const submit = (place) => {
    const found = validate(state);
    setErrors(found);
    setFormError(Object.keys(found).length ? 'Check the highlighted fields.' : null);
    if (Object.keys(found).length === 0) save.mutate({ place });
  };

  const addLine = (v) => {
    if (currency && v.currency !== currency) {
      setFormError(`This order is in ${currency}; ${v.sku} is priced in ${v.currency}.`);
      return;
    }
    setState((s) => {
      const existing = s.lines.findIndex((l) => l.variantId === v.variantId);
      if (existing >= 0) {
        const lines = [...s.lines];
        lines[existing] = {
          ...lines[existing],
          quantity: String((Number(lines[existing].quantity) || 0) + 1),
        };
        return { ...s, lines };
      }
      return { ...s, lines: [...s.lines, { ...v, unitPrice: v.price, quantity: '1' }] };
    });
  };
  const updateLine = (i, changes) =>
    setState((s) => ({ ...s, lines: s.lines.map((l, j) => (j === i ? { ...l, ...changes } : l)) }));
  const removeLine = (i) => setState((s) => ({ ...s, lines: s.lines.filter((_, j) => j !== i) }));

  const addresses = customerDetail.data?.addresses ?? [];

  // Picking a customer preselects their default address (the user can still change it).
  useEffect(() => {
    const defaultAddress = customerDetail.data?.addresses.find((a) => a.isDefault);
    if (defaultAddress && !state.addressChosen && state.shippingAddressId === '') {
      setState((s) => ({ ...s, shippingAddressId: defaultAddress.id }));
    }
  }, [customerDetail.data, state.addressChosen, state.shippingAddressId]);

  return (
    <div className="grid gap-6 lg:grid-cols-3 [&>*]:min-w-0">
      {prompt}
      <div className="space-y-6 lg:col-span-2">
        {formError && <Alert tone="error">{formError}</Alert>}

        <Card title="Products">
          <div className="space-y-4">
            {activeStores.length > 1 && (
              <SelectField
                label="Fulfil from store"
                value={state.storeId || activeStores[0].id}
                onChange={(e) => set({ storeId: e.target.value })}
                options={activeStores.map((s) => ({ value: s.id, label: s.name }))}
                error={errors.storeId}
              />
            )}
            <ProductPicker storeId={state.storeId || activeStores[0]?.id} onPick={addLine} />
            {errors.items && <p className="text-sm text-red-600">{errors.items}</p>}
            {state.lines.length > 0 && (
              <div className="relative -mx-5 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-ink-50 text-left text-[0.8125rem] font-semibold text-ink-600">
                    <tr>
                      <th scope="col" className="px-5 py-2">
                        Product
                      </th>
                      <th scope="col" className="px-3 py-2">
                        Quantity
                      </th>
                      <th scope="col" className="px-3 py-2 text-right">
                        Price
                      </th>
                      <th scope="col" className="px-3 py-2 text-right">
                        Total
                      </th>
                      <th scope="col" className="px-5 py-2">
                        <span className="sr-only">Remove</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100">
                    {state.lines.map((l, i) => {
                      const qtyError =
                        errors[`items.${i}.quantity`] ?? errors[`items.${i}.variantId`];
                      const over = l.available !== null && Number(l.quantity) > l.available;
                      return (
                        <tr key={l.variantId}>
                          <td className="px-5 py-2">
                            <p className="font-medium text-ink-900">{l.productName}</p>
                            <p className="text-xs text-ink-500">
                              <Sku>{l.sku}</Sku>
                              {l.variantName !== 'Default' && ` · ${l.variantName}`}
                            </p>
                          </td>
                          <td className="px-3 py-2 align-top">
                            <input
                              aria-label={`Quantity of ${l.sku}`}
                              inputMode="numeric"
                              value={l.quantity}
                              onChange={(e) => updateLine(i, { quantity: e.target.value })}
                              aria-invalid={qtyError ? true : undefined}
                              className={`block w-20 rounded-md border-0 px-2.5 py-1.5 text-sm ring-1 ring-inset focus:ring-2 ${qtyError ? 'ring-red-400' : 'ring-ink-300 focus:ring-brand-600'}`}
                            />
                            {qtyError ? (
                              <p className="mt-1 text-xs text-red-600">{qtyError}</p>
                            ) : over ? (
                              <p className="mt-1 text-xs text-amber-700">
                                Only {l.available} available
                              </p>
                            ) : null}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {formatMoney(l.unitPrice, l.currency)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {formatMoney(
                              (Math.round(Number(l.unitPrice) * 100) * (Number(l.quantity) || 0)) /
                                100,
                              l.currency,
                            )}
                          </td>
                          <td className="px-5 py-2 text-right">
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-label={`Remove ${l.sku}`}
                              onClick={() => removeLine(i)}
                            >
                              <TrashIcon aria-hidden="true" className="size-4" />
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </Card>

        <Card title="Customer and delivery">
          <div className="space-y-4">
            {state.customer ? (
              <div className="flex items-start justify-between gap-3 rounded-md bg-ink-50 p-3 text-sm">
                <div>
                  <p className="font-medium text-ink-900">{state.customer.name}</p>
                  <p className="text-ink-500">{state.customer.email ?? 'No email'}</p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Remove customer"
                  onClick={() =>
                    set({
                      customer: null,
                      shippingAddressId: state.keptAddress ? KEEP : '',
                      addressChosen: false,
                    })
                  }
                >
                  <XMarkIcon aria-hidden="true" className="size-4" />
                </Button>
              </div>
            ) : (
              <CustomerPicker
                onPick={(c) => set({ customer: c, shippingAddressId: '', addressChosen: false })}
              />
            )}
            {errors.customerId && <p className="text-sm text-red-600">{errors.customerId}</p>}
            {(state.customer || state.keptAddress) && (
              <SelectField
                label="Ship to"
                value={state.shippingAddressId}
                onChange={(e) => set({ shippingAddressId: e.target.value, addressChosen: true })}
                placeholder={
                  state.customer && customerDetail.isPending
                    ? 'Loading addresses…'
                    : 'No delivery (collected in store)'
                }
                options={[
                  ...(state.keptAddress
                    ? [
                        {
                          value: KEEP,
                          label: `Current: ${state.keptAddress.line1}, ${state.keptAddress.city}`,
                        },
                      ]
                    : []),
                  ...addresses.map((a) => ({
                    value: a.id,
                    label: `${a.label ? `${a.label}: ` : ''}${a.line1}, ${a.city}, ${countryName(a.country)}${a.isDefault ? ' (default)' : ''}`,
                  })),
                ]}
                error={errors.shippingAddressId}
              />
            )}
            <div>
              <label htmlFor="order-notes" className="block text-sm font-medium text-ink-800">
                Notes <span className="font-normal text-ink-500">(optional)</span>
              </label>
              <textarea
                id="order-notes"
                rows={2}
                value={state.notes}
                onChange={(e) => set({ notes: e.target.value })}
                maxLength={1000}
                className="mt-1.5 block w-full rounded-md border-0 px-3 py-2 text-sm ring-1 ring-inset ring-ink-300 focus:ring-2 focus:ring-brand-600"
              />
            </div>
          </div>
        </Card>
      </div>

      <div className="space-y-6">
        <Card title="Charges">
          <div className="space-y-4">
            <TextField
              label="Discount"
              inputMode="decimal"
              placeholder="0.00"
              value={state.discountTotal}
              onChange={(e) => set({ discountTotal: e.target.value })}
              error={errors.discountTotal}
            />
            <TextField
              label="Shipping"
              inputMode="decimal"
              placeholder="0.00"
              value={state.shippingTotal}
              onChange={(e) => set({ shippingTotal: e.target.value })}
              error={errors.shippingTotal}
            />
            <TextField
              label="Tax rate (%)"
              inputMode="decimal"
              placeholder="0"
              value={state.taxPercent}
              onChange={(e) => set({ taxPercent: e.target.value })}
              error={errors.taxRate}
              hint="Applied after the discount."
            />
          </div>
        </Card>
        <Card title="Summary">
          <dl className="space-y-2 text-sm">
            {[
              ['Subtotal', totals.subtotal, false],
              ['Discount', totals.discountTotal, true],
              ['Tax', totals.taxTotal, false],
              ['Shipping', totals.shippingTotal, false],
            ].map(([label, value, negative]) => (
              <div key={label} className="flex justify-between">
                <dt className="text-ink-600">{label}</dt>
                <dd className="tabular-nums">
                  {!currency
                    ? '—'
                    : negative && Number(value) > 0
                      ? `−${formatMoney(value, currency)}`
                      : formatMoney(value, currency)}
                </dd>
              </div>
            ))}
            <div className="flex justify-between border-t border-ink-200 pt-2 text-base font-semibold">
              <dt>Total</dt>
              <dd className="tabular-nums">
                {currency ? formatMoney(totals.total, currency) : '—'}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-ink-500">
            Estimated. The final amounts are calculated when the order is saved.
          </p>
          <div className="mt-5 flex flex-col gap-2">
            <Button
              loading={save.isPending && save.variables?.place}
              disabled={save.isPending}
              onClick={() => submit(true)}
            >
              Save and place order
            </Button>
            <Button
              variant="secondary"
              loading={save.isPending && !save.variables?.place}
              disabled={save.isPending}
              onClick={() => submit(false)}
            >
              Save draft
            </Button>
            <Link
              to={savedId ? `/orders/${savedId}` : '/orders'}
              className="py-1 text-center text-sm font-medium text-ink-600 hover:text-ink-900"
            >
              Cancel
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}

export function OrderFormPage() {
  const { orderId } = useParams();
  // "New order" from a customer's page passes ?customerId= to start with that customer.
  const [params] = useSearchParams();
  const customerId = orderId ? null : params.get('customerId');
  const order = useQuery({
    queryKey: ['order', orderId],
    queryFn: () => getOrder(orderId),
    enabled: Boolean(orderId),
  });
  const presetCustomer = useQuery({
    queryKey: ['customer', customerId],
    queryFn: () => getCustomer(customerId),
    enabled: Boolean(customerId),
  });

  if (orderId && order.isPending) return <SkeletonRows rows={6} label="Loading order" />;
  if (customerId && presetCustomer.isPending) {
    return <SkeletonRows rows={6} label="Loading customer" />;
  }
  if (orderId && order.isError) {
    return <Alert tone="error">{getApiError(order.error).message}</Alert>;
  }
  if (orderId && order.data.status !== 'DRAFT') {
    return (
      <Alert
        tone="info"
        action={
          <Link to={`/orders/${orderId}`} className="text-sm font-medium">
            View the order
          </Link>
        }
      >
        Only draft orders can be edited.
      </Alert>
    );
  }
  return (
    <>
      <PageHeader
        title={orderId ? 'Edit draft order' : 'New order'}
        description="Prices come from your catalog; stock is reserved when the order is placed."
      />
      {customerId && presetCustomer.isError && (
        <div className="mb-6">
          <Alert tone="warning">
            The customer could not be loaded ({getApiError(presetCustomer.error).message}). Choose
            one below.
          </Alert>
        </div>
      )}
      <OrderForm
        key={orderId ?? `new-${customerId ?? ''}`}
        order={orderId ? order.data : null}
        initialCustomer={presetCustomer.data?.archived ? null : presetCustomer.data}
      />
    </>
  );
}
