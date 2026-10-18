import { useEffect } from 'react';

/** Sets the browser tab title for a page ("Pricing · Vendora"), restoring the default after. */
export function useDocumentTitle(title) {
  useEffect(() => {
    const previous = document.title;
    document.title = title ? `${title} · Vendora` : 'Vendora';
    return () => {
      document.title = previous;
    };
  }, [title]);
}
