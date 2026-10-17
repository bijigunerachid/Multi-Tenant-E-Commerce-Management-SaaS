import { forwardRef } from 'react';
import { Spinner } from './Spinner.jsx';

const VARIANTS = {
  primary: 'bg-indigo-600 text-white hover:bg-indigo-500 shadow-sm',
  secondary: 'bg-white text-slate-900 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 shadow-sm',
  danger: 'bg-red-600 text-white hover:bg-red-500 shadow-sm',
  ghost: 'text-slate-700 hover:bg-slate-100',
};
const SIZES = { sm: 'px-2.5 py-1.5 text-sm', md: 'px-3.5 py-2 text-sm' };

/** `loading` disables the button and shows a spinner, which also prevents double submits. */
export const Button = forwardRef(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    disabled,
    className = '',
    children,
    type = 'button',
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-not-allowed disabled:opacity-60 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...props}
    >
      {loading && <Spinner className="size-4" />}
      {children}
    </button>
  );
});
