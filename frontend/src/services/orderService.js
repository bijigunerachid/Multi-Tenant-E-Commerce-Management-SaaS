import { apiClient, unwrap } from '../lib/apiClient.js';

/** Returns { data, meta } (paginated). */
export const listOrders = (params) => apiClient.get('/orders', { params }).then((res) => res.data);
export const getOrder = (id) => unwrap(apiClient.get(`/orders/${id}`));
export const createOrder = (body) => unwrap(apiClient.post('/orders', body));
export const updateOrder = (id, body) => unwrap(apiClient.put(`/orders/${id}`, body));
export const deleteOrder = (id) => apiClient.delete(`/orders/${id}`);
export const transitionOrder = (id, action, note) =>
  unwrap(apiClient.post(`/orders/${id}/transitions`, { action, note: note || undefined }));
export const cancelOrder = (id, reason) =>
  unwrap(apiClient.post(`/orders/${id}/cancel`, { reason }));
export const searchSellableVariants = (params) =>
  unwrap(apiClient.get('/orders/sellable-variants', { params }));

/** Downloads the CSV export (errors such as rate limits come back as JSON). */
export async function downloadOrderExport(params) {
  let res;
  try {
    res = await apiClient.get('/orders/export', { params, responseType: 'blob' });
  } catch (error) {
    const blob = error.response?.data;
    if (blob instanceof Blob) {
      try {
        error.response.data = JSON.parse(await blob.text());
      } catch {
        // leave as is
      }
    }
    throw error;
  }
  const name =
    /filename="([^"]+)"/.exec(res.headers['content-disposition'] ?? '')?.[1] ?? 'orders.csv';
  const url = URL.createObjectURL(res.data);
  const link = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return name;
}
