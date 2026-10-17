import { randomUUID } from 'node:crypto';

// Accept a caller-supplied ID (from a proxy or load balancer) only if it is short and plain,
// so it cannot be used to inject content into logs.
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

export function resolveRequestId(req, res) {
  const incoming = req.headers['x-request-id'];
  const id =
    typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', id);
  return id;
}
