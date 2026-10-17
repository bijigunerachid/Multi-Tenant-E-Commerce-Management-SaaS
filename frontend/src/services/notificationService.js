import { apiClient } from '../lib/apiClient.js';

/** The signed-in member's notifications. Returns { data, meta: { total, unreadCount, ... } }. */
export const listNotifications = (params) =>
  apiClient.get('/notifications', { params }).then((res) => res.data);

/** Returns the number of unread notifications. */
export const getUnreadCount = () =>
  apiClient.get('/notifications/unread-count').then((res) => res.data.data.count);

export const markNotificationRead = (id) =>
  apiClient.post(`/notifications/${id}/read`).then((res) => res.data.data);

export const markAllNotificationsRead = () =>
  apiClient.post('/notifications/read-all').then((res) => res.data.data);

/** Returns [{ type, email }] for the types this member receives. */
export const getNotificationPreferences = () =>
  apiClient.get('/notifications/preferences').then((res) => res.data.data);

/** email: { [type]: boolean }. Returns the saved preferences. */
export const updateNotificationPreferences = (email) =>
  apiClient.put('/notifications/preferences', { email }).then((res) => res.data.data);
