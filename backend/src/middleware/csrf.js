import { forbidden } from '../utils/errors.js';
import { safeEqual } from '../utils/crypto.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF protection for cookie-authenticated requests. On every state-changing request:
 * 1. If the browser sent an Origin header, it must be one of the allowed origins. This also
 *    stops login CSRF on the public endpoints, which have no session yet.
 * 2. If the request carries a session, X-CSRF-Token must match the token stored in it.
 *    A cross-site page can make the browser send the cookie but cannot read the token.
 *
 * Requests with neither an Origin nor a session cookie (curl, server-to-server) carry no
 * ambient credentials, so there is nothing to forge.
 */
export function csrfProtection({ allowedOrigins, exemptPaths = [] }) {
  const origins = new Set(allowedOrigins);

  return function checkCsrf(req, _res, next) {
    if (SAFE_METHODS.has(req.method) || exemptPaths.includes(req.path)) return next();

    const origin = req.headers.origin;
    if (origin !== undefined && !origins.has(origin)) {
      return next(forbidden('CSRF_ORIGIN_REJECTED', 'Request origin is not allowed'));
    }

    if (req.session && !safeEqual(req.headers['x-csrf-token'], req.session.csrfToken)) {
      return next(forbidden('CSRF_TOKEN_INVALID', 'Missing or invalid CSRF token'));
    }

    next();
  };
}
