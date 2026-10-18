import { forwardRef, useId } from 'react';

const controlClass = (invalid) =>
  `block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-ink-900 ring-1 ring-inset placeholder:text-ink-400 focus:ring-2 focus:ring-inset disabled:bg-ink-50 disabled:text-ink-500 ${
    invalid ? 'ring-red-400 focus:ring-red-500' : 'ring-ink-300 focus:ring-brand-600'
  }`;

function Field({ id, label, hint, error, children }) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-ink-800">
        {label}
      </label>
      <div className="mt-1.5">{children}</div>
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 text-sm text-red-600">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-sm text-ink-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Text input with label, hint and error, wired for screen readers. Works with RHF `register`. */
export const TextField = forwardRef(function TextField({ label, hint, error, id, ...props }, ref) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <Field id={fieldId} label={label} hint={hint} error={error}>
      <input
        ref={ref}
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
        className={controlClass(Boolean(error))}
        // Addresses and codes are not words: no spellcheck squiggles or auto-capitalisation.
        {...(props.type === 'email' ? { spellCheck: false, autoCapitalize: 'none' } : {})}
        {...props}
      />
    </Field>
  );
});

export const SelectField = forwardRef(function SelectField(
  { label, hint, error, id, options, placeholder, ...props },
  ref,
) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <Field id={fieldId} label={label} hint={hint} error={error}>
      <select
        ref={ref}
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
        className={controlClass(Boolean(error))}
        {...props}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
});
