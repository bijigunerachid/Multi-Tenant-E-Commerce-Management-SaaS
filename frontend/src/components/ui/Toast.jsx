import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { CheckCircleIcon, XCircleIcon, XMarkIcon } from '@heroicons/react/20/solid';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id) => setToasts((all) => all.filter((t) => t.id !== id)), []);
  const show = useCallback(
    (tone, message) => {
      const id = nextId.current++;
      setToasts((all) => [...all, { id, tone, message }]);
      setTimeout(() => dismiss(id), 5000);
    },
    [dismiss],
  );
  const api = useMemo(
    () => ({ success: (m) => show('success', m), error: (m) => show('error', m) }),
    [show],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 sm:items-end"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.tone === 'error' ? 'alert' : 'status'}
            className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg bg-white p-4 text-sm shadow-lg ring-1 ring-slate-200"
          >
            {t.tone === 'error' ? (
              <XCircleIcon aria-hidden="true" className="size-5 shrink-0 text-red-500" />
            ) : (
              <CheckCircleIcon aria-hidden="true" className="size-5 shrink-0 text-emerald-500" />
            )}
            <p className="flex-1 text-slate-800">{t.message}</p>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="text-slate-400 hover:text-slate-600"
            >
              <XMarkIcon aria-hidden="true" className="size-5" />
              <span className="sr-only">Dismiss</span>
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
