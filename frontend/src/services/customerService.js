import { apiClient, unwrap } from '../lib/apiClient.js';

/** Returns { data, meta } (paginated). */
export const listCustomers = (params) =>
  apiClient.get('/customers', { params }).then((res) => res.data);
export const getCustomer = (id) => unwrap(apiClient.get(`/customers/${id}`));
export const createCustomer = (body) => unwrap(apiClient.post('/customers', body));
export const updateCustomer = (id, body) => unwrap(apiClient.patch(`/customers/${id}`, body));
export const setCustomerArchived = (id, archived) =>
  unwrap(apiClient.patch(`/customers/${id}/status`, { archived }));
export const deleteCustomer = (id) => apiClient.delete(`/customers/${id}`);

export const addAddress = (customerId, body) =>
  unwrap(apiClient.post(`/customers/${customerId}/addresses`, body));
export const updateAddress = (customerId, addressId, body) =>
  unwrap(apiClient.patch(`/customers/${customerId}/addresses/${addressId}`, body));
export const deleteAddress = (customerId, addressId) =>
  apiClient.delete(`/customers/${customerId}/addresses/${addressId}`);

/**
 * Downloads the CSV export. Fetched through the API client (not a plain link) so errors such
 * as rate limits arrive as JSON and can be shown to the user instead of saved as a file.
 */
export async function downloadCustomerExport(params) {
  let res;
  try {
    res = await apiClient.get('/customers/export', { params, responseType: 'blob' });
  } catch (error) {
    // With responseType blob, an error body is a Blob too: turn it back into JSON.
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
    /filename="([^"]+)"/.exec(res.headers['content-disposition'] ?? '')?.[1] ?? 'customers.csv';
  const url = URL.createObjectURL(res.data);
  const link = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return name;
}
