import { useCallback, useState } from 'react';
import { getApiError } from '../lib/apiClient.js';

/**
 * Maps an API error onto a React Hook Form: field errors go next to their fields, anything
 * else becomes a form-level message. Returns [formError, handleError, clearFormError].
 */
export function useServerErrors(setError) {
  const [formError, setFormError] = useState(null);

  const handleError = useCallback(
    (error) => {
      const apiError = getApiError(error);
      const fieldErrors = apiError.details?.fieldErrors ?? {};
      const fields = Object.entries(fieldErrors);
      for (const [field, message] of fields) {
        setError(field, { type: 'server', message });
      }
      setFormError(
        fields.length && apiError.code === 'VALIDATION_FAILED' ? null : apiError.message,
      );
    },
    [setError],
  );

  return [formError, handleError, () => setFormError(null)];
}
