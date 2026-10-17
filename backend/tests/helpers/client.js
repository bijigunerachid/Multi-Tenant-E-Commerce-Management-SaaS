import request from 'supertest';

export const ORIGIN = 'http://localhost:5173';
const API = '/api/v1';

/**
 * Behaves like the web app: keeps cookies, sends the allowed Origin, and sends the CSRF token
 * it received from the last session payload (login, register, /auth/me ...).
 */
export function apiClient(app) {
  const agent = request.agent(app);
  let csrfToken = null;

  const send = async (method, path, body, { csrf = true, origin = ORIGIN } = {}) => {
    let req = agent[method](API + path);
    if (origin) req = req.set('Origin', origin);
    if (csrf && csrfToken) req = req.set('X-CSRF-Token', csrfToken);
    if (body !== undefined) req = req.send(body);
    const res = await req;
    const token = res.body?.data?.csrfToken ?? res.body?.data?.session?.csrfToken;
    if (token) csrfToken = token;
    return res;
  };

  return {
    get: (path, opts) => send('get', path, undefined, opts),
    post: (path, body, opts) => send('post', path, body, opts),
    patch: (path, body, opts) => send('patch', path, body, opts),
    put: (path, body, opts) => send('put', path, body, opts),
    delete: (path, opts) => send('delete', path, undefined, opts),
    get csrfToken() {
      return csrfToken;
    },
    set csrfToken(value) {
      csrfToken = value;
    },
    agent,
  };
}
