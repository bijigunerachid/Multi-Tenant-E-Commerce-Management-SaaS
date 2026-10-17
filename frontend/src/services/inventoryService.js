import { apiClient, unwrap } from '../lib/apiClient.js';

/** Paginated lists return { data, meta }. */
export const listInventory = (params) =>
  apiClient.get('/inventory', { params }).then((res) => res.data);
export const getInventorySummary = (params) =>
  unwrap(apiClient.get('/inventory/summary', { params }));
export const listMovements = (params) =>
  apiClient.get('/inventory/movements', { params }).then((res) => res.data);
export const receiveStock = (body) => unwrap(apiClient.post('/inventory/receipts', body));
export const adjustStock = (body) => unwrap(apiClient.post('/inventory/adjustments', body));
