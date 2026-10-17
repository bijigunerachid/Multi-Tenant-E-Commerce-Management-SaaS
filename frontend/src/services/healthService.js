import { apiClient } from '../lib/apiClient.js';

/** Returns `{ status, checks }`. A 503 still carries the per-dependency checks, so pass them on. */
export async function fetchReadiness() {
  const res = await apiClient.get('/health/ready', {
    validateStatus: (status) => status === 200 || status === 503,
  });
  return res.data.data;
}
