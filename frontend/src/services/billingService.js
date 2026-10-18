import { apiClient, unwrap } from '../lib/apiClient.js';

/** The organization's plan, status, trial end and usage. */
export const getSubscription = () => unwrap(apiClient.get('/subscriptions/current'));

/** The plans on offer, cheapest first. */
export const listPlans = () => unwrap(apiClient.get('/subscriptions/plans'));

/** Starts Stripe Checkout for a plan. Returns { url } to send the browser to. */
export const startCheckout = (plan) => unwrap(apiClient.post('/subscriptions/checkout', { plan }));

/** Opens the Stripe Customer Portal. Returns { url }. */
export const openBillingPortal = () => unwrap(apiClient.post('/subscriptions/portal'));

/** Vendora's invoices to this organization. Returns { data, meta }. */
export const listInvoices = (params) =>
  apiClient.get('/subscriptions/invoices', { params }).then((res) => res.data);
