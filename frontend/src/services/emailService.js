import { apiClient } from '../lib/apiClient.js';

/** The organization's email delivery history. Returns { data, meta } (paginated). */
export const listEmailDeliveries = (params) =>
  apiClient.get('/email-deliveries', { params }).then((res) => res.data);
