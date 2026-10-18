import { apiClient, unwrap } from '../lib/apiClient.js';

// Platform administration (Vendora staff). The API refuses everyone else.

export const getPlatformStats = () => unwrap(apiClient.get('/admin/stats'));

/** Returns { data, meta } (paginated). */
export const listAllOrganizations = (params) =>
  apiClient.get('/admin/organizations', { params }).then((res) => res.data);

export const getAdminOrganization = (id) => unwrap(apiClient.get(`/admin/organizations/${id}`));

export const suspendOrganization = (id, reason) =>
  unwrap(apiClient.post(`/admin/organizations/${id}/suspend`, { reason }));

export const reactivateOrganization = (id, reason) =>
  unwrap(apiClient.post(`/admin/organizations/${id}/reactivate`, { reason }));

/** body: { plan, status: 'TRIALING' | 'ACTIVE' | 'CANCELED', trialEndsAt?, reason } */
export const changeOrganizationSubscription = (id, body) =>
  unwrap(apiClient.put(`/admin/organizations/${id}/subscription`, body));

/** Returns { data, meta }. The reason is recorded in the organization's audit log. */
export const getOrganizationAuditLogs = (id, params) =>
  apiClient.get(`/admin/organizations/${id}/audit-logs`, { params }).then((res) => res.data);
