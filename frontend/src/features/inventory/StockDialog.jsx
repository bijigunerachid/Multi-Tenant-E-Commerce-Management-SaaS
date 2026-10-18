import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert } from '../../components/ui/layout.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Dialog } from '../../components/ui/Dialog.jsx';
import { SelectField, TextField } from '../../components/ui/fields.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useServerErrors } from '../../hooks/useServerErrors.js';
import { adjustStock, receiveStock } from '../../services/inventoryService.js';
import { ADJUSTMENT_REASONS } from './labels.js';

const wholeNumber = /^-?\d{1,7}$/;

const receiveSchema = z.object({
  quantity: z
    .string()
    .trim()
    .regex(/^\d{1,7}$/, 'Enter a whole number')
    .refine((v) => Number(v) > 0, { error: 'Enter at least 1' }),
  note: z.string().max(500, 'Use at most 500 characters'),
});

const adjustSchema = z
  .object({
    mode: z.enum(['change', 'setTo']),
    amount: z.string().trim().regex(wholeNumber, 'Enter a whole number'),
    reason: z.string().min(1, 'Choose a reason'),
    note: z.string().max(500, 'Use at most 500 characters'),
  })
  .superRefine((v, ctx) => {
    if (v.mode === 'change' && Number(v.amount) === 0) {
      ctx.addIssue({ code: 'custom', path: ['amount'], message: 'Enter a change other than 0' });
    }
    if (v.mode === 'setTo' && Number(v.amount) < 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['amount'],
        message: 'A counted quantity cannot be negative',
      });
    }
    if (v.reason === 'OTHER' && !v.note.trim()) {
      ctx.addIssue({ code: 'custom', path: ['note'], message: 'Explain the adjustment' });
    }
  });

function CurrentStock({ row }) {
  return (
    <dl className="grid grid-cols-3 gap-3 rounded-md bg-ink-50 p-3 text-sm">
      {[
        ['On hand', row.onHand],
        ['Reserved', row.reserved],
        ['Available', row.available],
      ].map(([label, value]) => (
        <div key={label}>
          <dt className="text-ink-500">{label}</dt>
          <dd className="text-lg font-semibold tabular-nums text-ink-900">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Receive or adjust stock for one variant in one store. The server applies the change
 * atomically and refuses anything that would take stock below what is reserved.
 */
export function StockDialog({ action, row, storeId, onClose }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const receiving = action === 'receive';
  const form = useForm({
    resolver: zodResolver(receiving ? receiveSchema : adjustSchema),
    defaultValues: receiving
      ? { quantity: '', note: '' }
      : { mode: 'change', amount: '', reason: '', note: '' },
  });
  const {
    register,
    handleSubmit,
    setError,
    watch,
    formState: { errors },
  } = form;
  const [formError, handleError] = useServerErrors(setError);
  const mode = watch('mode');

  const mutation = useMutation({
    mutationFn: (v) =>
      receiving
        ? receiveStock({
            storeId,
            variantId: row.variantId,
            quantity: Number(v.quantity),
            note: v.note.trim() || undefined,
          })
        : adjustStock({
            storeId,
            variantId: row.variantId,
            ...(v.mode === 'change' ? { change: Number(v.amount) } : { setTo: Number(v.amount) }),
            reason: v.reason,
            note: v.note.trim() || undefined,
          }),
    onSuccess: (level) => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-summary'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-movements'] });
      toast.success(`${level.sku}: ${level.onHand} on hand, ${level.available} available.`);
      onClose();
    },
    onError: (e) => {
      // Show the reason for a refused change (for example reserved units) in the form.
      const details = e?.response?.data?.error?.details;
      if (details?.message) setError('root.server', { message: details.message });
      handleError(e);
    },
  });

  const title = `${receiving ? 'Receive stock' : 'Adjust stock'}: ${row.sku}`;
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      description={`${row.productName}${row.variantName && row.variantName !== 'Default' ? ` · ${row.variantName}` : ''}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="stock-form" loading={mutation.isPending}>
            {receiving ? 'Receive stock' : 'Save adjustment'}
          </Button>
        </>
      }
    >
      <form
        id="stock-form"
        noValidate
        onSubmit={handleSubmit((v) => mutation.mutate(v))}
        className="space-y-4"
      >
        <CurrentStock row={row} />
        {formError && (
          <Alert tone="error">
            {formError}
            {errors.root?.server?.message && <> {errors.root.server.message}.</>}
          </Alert>
        )}
        {receiving ? (
          <TextField
            label="Quantity received"
            inputMode="numeric"
            autoFocus
            error={errors.quantity?.message}
            {...register('quantity')}
          />
        ) : (
          <>
            <fieldset>
              <legend className="text-sm font-medium text-ink-800">Type of adjustment</legend>
              <div className="mt-2 flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <input type="radio" value="change" {...register('mode')} /> Add or remove units
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" value="setTo" {...register('mode')} /> Set counted quantity
                </label>
              </div>
            </fieldset>
            <TextField
              label={mode === 'setTo' ? 'Counted quantity' : 'Change (use - to remove)'}
              hint={
                mode === 'setTo'
                  ? 'The quantity physically counted in the store.'
                  : 'For example -2 for two damaged units, 3 for three found.'
              }
              inputMode="numeric"
              error={errors.amount?.message ?? errors.change?.message ?? errors.setTo?.message}
              {...register('amount')}
            />
            <SelectField
              label="Reason"
              placeholder="Choose a reason"
              options={ADJUSTMENT_REASONS}
              error={errors.reason?.message}
              {...register('reason')}
            />
          </>
        )}
        <TextField
          label={receiving ? 'Note (optional)' : 'Note'}
          hint={
            receiving
              ? 'For example the supplier delivery or purchase order number.'
              : 'Required when the reason is "Other".'
          }
          error={errors.note?.message}
          {...register('note')}
        />
      </form>
    </Dialog>
  );
}
