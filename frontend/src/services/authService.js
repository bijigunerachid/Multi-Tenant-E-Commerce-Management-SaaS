import { apiClient, unwrap } from '../lib/apiClient.js';

/** Returns the session payload, or null when signed out. */
export async function getSession() {
  try {
    return await unwrap(apiClient.get('/auth/me', { skipSessionLost: true }));
  } catch (error) {
    if (error.response?.status === 401) return null;
    throw error;
  }
}

export const login = (body) => unwrap(apiClient.post('/auth/login', body));
export const register = (body) => unwrap(apiClient.post('/auth/register', body));
export const logout = () => apiClient.post('/auth/logout');
export const logoutEverywhere = () => apiClient.post('/auth/logout-all');
export const updateProfile = (body) => unwrap(apiClient.patch('/auth/me', body));
export const changePassword = (body) => apiClient.post('/auth/password/change', body);
export const verifyEmail = (token) => apiClient.post('/auth/email/verify', { token });
export const resendVerification = () => apiClient.post('/auth/email/resend');
export const requestPasswordReset = (body) => apiClient.post('/auth/password/forgot', body);
export const resetPassword = (body) => apiClient.post('/auth/password/reset', body);

// Two-factor sign-in.
/** Second sign-in step: { code } or { recoveryCode }. Returns the session. */
export const verifyMfa = (body) => unwrap(apiClient.post('/auth/mfa/verify', body));
export const getMfaStatus = () => unwrap(apiClient.get('/auth/mfa'));
/** Returns { secret, otpauthUrl } for the authenticator app. */
export const startMfaSetup = (password) => unwrap(apiClient.post('/auth/mfa/setup', { password }));
/** Confirms setup with a code. Returns { recoveryCodes }. */
export const enableMfa = (code) => unwrap(apiClient.post('/auth/mfa/enable', { code }));
export const disableMfa = (body) => apiClient.post('/auth/mfa/disable', body);
export const regenerateRecoveryCodes = (body) =>
  unwrap(apiClient.post('/auth/mfa/recovery-codes', body));
