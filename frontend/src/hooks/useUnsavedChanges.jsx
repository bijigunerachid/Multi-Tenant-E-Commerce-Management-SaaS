import { useCallback, useEffect, useRef } from 'react';
import { useBlocker } from 'react-router';
import { ConfirmDialog } from '../components/ui/Dialog.jsx';

/**
 * Warns before leaving a form with unsaved changes: the browser's own prompt when closing or
 * reloading the tab, and a confirmation dialog for links inside the app.
 *
 *   const { prompt, allowNavigation } = useUnsavedChanges(isDirty);
 *   // call allowNavigation() right before navigating away after a successful save
 *   return <>{form}{prompt}</>;
 */
export function useUnsavedChanges(dirty) {
  const guard = useRef(dirty);
  guard.current = dirty;

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      guard.current &&
      (currentLocation.pathname !== nextLocation.pathname ||
        currentLocation.search !== nextLocation.search),
  );

  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (event) => {
      event.preventDefault();
      // Some browsers still need returnValue set to show their prompt.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  // A save that navigates away on success must not be stopped by its own guard.
  const allowNavigation = useCallback(() => {
    guard.current = false;
  }, []);

  const prompt = (
    <ConfirmDialog
      open={blocker.state === 'blocked'}
      onClose={() => blocker.reset?.()}
      onConfirm={() => blocker.proceed?.()}
      title="Leave without saving?"
      confirmLabel="Leave and discard changes"
    >
      Your changes on this page have not been saved.
    </ConfirmDialog>
  );

  return { prompt, allowNavigation };
}
