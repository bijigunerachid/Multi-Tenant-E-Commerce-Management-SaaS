import { apiClient, unwrap } from '../lib/apiClient.js';

/** The organization's plan, status, trial end and usage. */
export const getSubscription = () => unwrap(apiClient.get('/subscriptions/current'));

/** The plans on offer, cheapest first. */
export const listPlans = () => unwrap(apiClient.get('/subscriptions/plans'));
