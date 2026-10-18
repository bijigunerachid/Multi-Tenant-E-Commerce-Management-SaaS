import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { CheckCircleIcon, XCircleIcon, XMarkIcon } from '@heroicons/react/20/solid';

const ToastContext = createContext(null);
// Errors usually need reading and acting on, so they stay longer than confirmations.
const DURATION_MS = { success: 5_000, error: 10_000 };

/** One toast. Its timer pauses while it is hovered or holds keyboard focus. */
function Toast({ toast, onDismiss }) {
  const remaining = useRef(DURATION_MS[toast.tone]);
  const startedAt = useRef(0);
  const timer = useRef(null);

  // Pointer and focus can both pause it; each call is a no-op when already in that state.
  const start = useCallback(() => {
    if (timer.current) return;
    startedAt.current = Date.now();
    timer.current = setTimeout(() => onDismiss(toast.id), remaining.current);
  }, [onDismiss, toast.id]);
  const pause = () => {
    if (!timer.current) return;
    clearTimeout(timer.current);
    timer.current = null;
    remaining.current -= Date.now() - startedAt.current;
  };
  useEffect(() => {
    start();
    return () => {
      clearTimeout(timer.current);
      timer.current = null;
    };
  }, [start]);

  return (
    <div
      role={toast.tone === 'error' ? 'alert' : 'status'}
      onMouseEnter={pause}
      onMouseLeave={start}
      onFocus={pause}
      onBlur={start}
      className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border border-ink-200 bg-white p-4 text-sm shadow-lg"
    >
      {toast.tone === 'error' ? (
        <XCircleIcon aria-hidden="true" className="size-5 shrink-0 text-red-600" />
      ) : (
        <CheckCircleIcon aria-hidden="true" className="size-5 shrink-0 text-brand-500" />
      )}
      <p className="min-w-0 flex-1 break-words text-ink-800">{toast.message}</p>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        className="rounded-sm text-ink-400 hover:text-ink-700 focus-visible:outline-2 focus-visible:outline-brand-600"
      >
        <XMarkIcon aria-hidden="true" className="size-5" />
        <span className="sr-only">Dismiss</span>
      </button>
    </div>
  );
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id) => setToasts((all) => all.filter((t) => t.id !== id)), []);
  const show = useCallback((tone, message) => {
    const id = nextId.current++;
    setToasts((all) => [...all, { id, tone, message }]);
  }, []);
  const api = useMemo(
    () => ({ success: (m) => show('success', m), error: (m) => show('error', m) }),
    [show],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:items-end"
      >
        {toasts.map((t) => (
          <Toast key={t.id} toast={t} onDismiss={dismiss} />
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
