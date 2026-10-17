import { apiClient, unwrap } from '../lib/apiClient.js';

export const listMembers = () => unwrap(apiClient.get('/members'));
export const changeMemberRole = (id, role) => unwrap(apiClient.patch(`/members/${id}`, { role }));
export const deactivateMember = (id) => unwrap(apiClient.post(`/members/${id}/deactivate`));
export const reactivateMember = (id) => unwrap(apiClient.post(`/members/${id}/reactivate`));

export const listInvitations = () => unwrap(apiClient.get('/members/invitations'));
export const inviteMember = (body) => unwrap(apiClient.post('/members/invitations', body));
export const revokeInvitation = (id) => apiClient.delete(`/members/invitations/${id}`);

export const previewInvitation = (token) =>
  unwrap(apiClient.post('/invitations/preview', { token }));
export const acceptInvitation = (body) => unwrap(apiClient.post('/invitations/accept', body));
