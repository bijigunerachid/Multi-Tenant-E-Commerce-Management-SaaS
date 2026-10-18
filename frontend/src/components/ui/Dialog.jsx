import { useEffect, useId, useRef } from 'react';
import { XMarkIcon } from '@heroicons/react/20/solid';
import { Button } from './Button.jsx';

/**
 * Modal built on the native <dialog> element: the browser provides the focus trap, Escape to
 * close, inert background and focus return.
 */
export function Dialog({ open, onClose, title, description, children, footer }) {
  const ref = useRef(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal?.();
    if (!open && dialog.open) dialog.close?.();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      aria-labelledby={titleId}
      // Phone gutter, scrolls inside itself when tall, and never scrolls the page behind it.
      className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto overscroll-contain rounded-lg bg-white p-0 shadow-xl backdrop:bg-ink-900/40"
    >
      {open && (
        <div>
          <div className="flex items-start justify-between gap-4 px-5 pt-5">
            <div>
              <h2 id={titleId} className="text-base font-semibold text-ink-900">
                {title}
              </h2>
              {description && <p className="mt-1 text-sm text-ink-600">{description}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1 text-ink-500 hover:bg-ink-100 focus-visible:outline-2 focus-visible:outline-brand-600"
            >
              <XMarkIcon aria-hidden="true" className="size-5" />
              <span className="sr-only">Close</span>
            </button>
          </div>
          <div className="px-5 py-4">{children}</div>
          {footer && (
            <div className="flex justify-end gap-2 border-t border-ink-200 px-5 py-3">{footer}</div>
          )}
        </div>
      )}
    </dialog>
  );
}

/** Confirmation for destructive or significant actions. */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  children,
  confirmLabel,
  tone = 'danger',
  loading,
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            onClick={onConfirm}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-ink-700">{children}</div>
    </Dialog>
  );
}
