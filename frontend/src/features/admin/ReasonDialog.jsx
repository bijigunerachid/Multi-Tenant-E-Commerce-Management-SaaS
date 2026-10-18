import { useId } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import { Alert } from '../../components/ui/layout.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Dialog } from '../../components/ui/Dialog.jsx';
import { useServerErrors } from '../../hooks/useServerErrors.js';

const schema = z.object({
  reason: z
    .string()
    .trim()
    .min(5, 'Give a reason (at least 5 characters)')
    .max(500, 'Use at most 500 characters'),
});

/** Confirms an admin action that needs a reason; the reason goes to the audit log. */
export function ReasonDialog({
  open,
  onClose,
  title,
  description,
  confirmLabel,
  tone,
  run,
  onDone,
}) {
  const id = useId();
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors },
  } = useForm({ resolver: zodResolver(schema) });
  const [formError, handleError] = useServerErrors(setError);
  const action = useMutation({
    mutationFn: ({ reason }) => run(reason),
    onSuccess: (result) => {
      reset();
      onDone(result);
    },
    onError: handleError,
  });
  const close = () => {
    reset();
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={action.isPending}>
            Cancel
          </Button>
          <Button
            type="submit"
            form={`${id}-form`}
            variant={tone === 'danger' ? 'danger' : 'primary'}
            loading={action.isPending}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <form
        id={`${id}-form`}
        noValidate
        onSubmit={handleSubmit((v) => action.mutate(v))}
        className="space-y-4"
      >
        {formError && <Alert tone="error">{formError}</Alert>}
        <div>
          <label htmlFor={`${id}-reason`} className="block text-sm font-medium text-ink-800">
            Reason
          </label>
          <textarea
            id={`${id}-reason`}
            rows={3}
            aria-invalid={errors.reason ? true : undefined}
            aria-describedby={`${id}-help`}
            className="mt-1.5 block w-full rounded-md border-0 px-3 py-2 text-sm ring-1 ring-inset ring-ink-300 focus:ring-2 focus:ring-inset focus:ring-brand-600"
            {...register('reason')}
          />
          <p
            id={`${id}-help`}
            className={`mt-1.5 text-sm ${errors.reason ? 'text-red-600' : 'text-ink-500'}`}
          >
            {errors.reason?.message ?? 'Recorded in the audit log with your name.'}
          </p>
        </div>
      </form>
    </Dialog>
  );
}
