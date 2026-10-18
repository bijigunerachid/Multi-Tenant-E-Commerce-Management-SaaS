import { apiClient, unwrap } from '../lib/apiClient.js';

export const createOrganization = (body) => unwrap(apiClient.post('/organizations', body));
export const switchOrganization = (id) => unwrap(apiClient.post(`/organizations/${id}/switch`));
export const getCurrentOrganization = () => unwrap(apiClient.get('/organizations/current'));
export const updateOrganization = (body) => unwrap(apiClient.patch('/organizations/current', body));

export const getOwnershipTransfer = () =>
  unwrap(apiClient.get('/organizations/current/ownership-transfer')).then((d) => d.transfer);
export const startOwnershipTransfer = (body) =>
  unwrap(apiClient.post('/organizations/current/ownership-transfer', body));
export const cancelOwnershipTransfer = () =>
  apiClient.delete('/organizations/current/ownership-transfer');
export const acceptOwnershipTransfer = () =>
  unwrap(apiClient.post('/organizations/current/ownership-transfer/accept'));

export const listStores = () => unwrap(apiClient.get('/stores'));
export const createStore = (body) => unwrap(apiClient.post('/stores', body));
export const updateStore = (id, body) => unwrap(apiClient.patch(`/stores/${id}`, body));
export const archiveStore = (id) => unwrap(apiClient.post(`/stores/${id}/archive`));
export const restoreStore = (id) => unwrap(apiClient.post(`/stores/${id}/restore`));
