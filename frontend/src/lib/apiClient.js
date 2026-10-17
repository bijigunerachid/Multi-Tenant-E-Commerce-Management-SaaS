import axios from 'axios';

/**
 * Single HTTP client for the API. Requests go to /api/v1 on the same origin (the Vite dev
 * server and the production reverse proxy forward it), and cookies are always sent.
 *
 * CSRF: the API returns a per-session token in every session payload. It is kept in memory
 * only (never in localStorage) and sent in X-CSRF-Token on every state-changing request.
 */
export const apiClient = axios.create({
  baseURL: '/api/v1',
  withCredentials: true,
  timeout: 15_000,
  headers: { Accept: 'application/json' },
});

let csrfToken = null;
let onSessionLost = () => {};

export function setCsrfToken(token) {
  csrfToken = token ?? null;
}

/** Called when the API says the session or tenant access is gone, so the UI can re-check. */
export function setSessionLostHandler(handler) {
  onSessionLost = handler;
}

const SAFE_METHODS = new Set(['get', 'head', 'options']);
const SESSION_LOST_CODES = new Set([
  'UNAUTHENTICATED',
  'NO_ACTIVE_ORGANIZATION',
  'ORGANIZATION_ACCESS_REVOKED',
  'ORGANIZATION_SUSPENDED',
]);

apiClient.interceptors.request.use((config) => {
  if (!SAFE_METHODS.has(config.method) && csrfToken) {
    config.headers['X-CSRF-Token'] = csrfToken;
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => {
    const token = response.data?.data?.csrfToken ?? response.data?.data?.session?.csrfToken;
    if (token) setCsrfToken(token);
    return response;
  },
  async (error) => {
    const code = error.response?.data?.error?.code;
    const config = error.config;

    // The token can be stale after the session was replaced in another tab: fetch the
    // current one and retry once.
    if (code === 'CSRF_TOKEN_INVALID' && config && !config._csrfRetried) {
      config._csrfRetried = true;
      try {
        await apiClient.get('/auth/me');
        config.headers['X-CSRF-Token'] = csrfToken;
        return apiClient(config);
      } catch {
        // fall through to the original error
      }
    }

    if (SESSION_LOST_CODES.has(code) && !config?.skipSessionLost) onSessionLost(code);
    return Promise.reject(error);
  },
);

/** Extracts the API's `{ error: { code, message, details, requestId } }` from an Axios error. */
export function getApiError(error) {
  const apiError = error?.response?.data?.error;
  if (apiError) return apiError;
  if (error?.response) {
    return { code: 'HTTP_ERROR', message: `The server responded with ${error.response.status}` };
  }
  return { code: 'NETWORK_ERROR', message: 'Could not reach the server. Check your connection.' };
}

/** Unwraps `{ data }` responses. */
export const unwrap = (promise) => promise.then((res) => res.data.data);
