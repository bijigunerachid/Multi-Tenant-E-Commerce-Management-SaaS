/**
 * A SKU shown as a shelf label: monospaced so codes can be read character by character, with
 * the punched hole of the Vendora tag. `translate="no"` keeps browser translation away from
 * codes. The text is the SKU alone, so searching the page for it still works.
 */
export function Sku({ children, className = '' }) {
  return (
    <span
      translate="no"
      className={`inline-flex max-w-full items-center gap-1 rounded-[3px] border border-ink-300 bg-white px-1.5 align-middle font-mono text-[0.6875rem] font-medium leading-[1.125rem] text-ink-800 before:size-1 before:shrink-0 before:rounded-full before:bg-ink-300 ${className}`}
    >
      <span className="truncate">{children}</span>
    </span>
  );
}
