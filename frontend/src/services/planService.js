import { apiClient, unwrap } from '../lib/apiClient.js';

/** The plans on offer (public: no session needed). */
export const getPublicPlans = () => unwrap(apiClient.get('/plans'));
