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

// User accounts. Every change needs a reason, recorded in the audit log.
/** Returns { data, meta } (paginated). */
export const listUsers = (params) =>
  apiClient.get('/admin/users', { params }).then((res) => res.data);
export const getAdminUser = (id) => unwrap(apiClient.get(`/admin/users/${id}`));
export const disableUser = (id, reason) =>
  unwrap(apiClient.post(`/admin/users/${id}/disable`, { reason }));
export const enableUser = (id, reason) =>
  unwrap(apiClient.post(`/admin/users/${id}/enable`, { reason }));
export const signOutUser = (id, reason) =>
  unwrap(apiClient.post(`/admin/users/${id}/sign-out`, { reason }));
export const resendUserVerification = (id) =>
  unwrap(apiClient.post(`/admin/users/${id}/verification-email`));
export const resetUserMfa = (id, reason) =>
  unwrap(apiClient.post(`/admin/users/${id}/mfa/reset`, { reason }));

/** Everything platform administrators did. Returns { data, meta }. */
export const listPlatformActivity = (params) =>
  apiClient.get('/admin/activity', { params }).then((res) => res.data);
