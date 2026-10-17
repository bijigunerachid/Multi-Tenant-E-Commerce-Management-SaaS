import { apiClient, unwrap } from '../lib/apiClient.js';

/** params: { days } or { from, to } (YYYY-MM-DD, in the organization's time zone). */
export const getDashboard = (params) => unwrap(apiClient.get('/reports/dashboard', { params }));
