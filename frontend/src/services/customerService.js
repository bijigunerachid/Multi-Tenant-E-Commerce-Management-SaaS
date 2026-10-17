import { apiClient, unwrap } from '../lib/apiClient.js';
import { downloadFile } from '../lib/download.js';

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

/** Saves the CSV export of the customers matching the filters; resolves to the file name. */
export const downloadCustomerExport = (params) =>
  downloadFile('/customers/export', params, 'customers.csv');
