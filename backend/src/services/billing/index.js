import { createStripeProvider } from './stripeProvider.js';

/**
 * The payment provider for Vendora's own plans, or null when billing is off
 * (BILLING_PROVIDER=none): trials and limits still work, buying a plan answers 503.
 *
 * A provider implements:
 *   name
 *   createCustomer({ organizationId, name, email }) → customer id
 *   createCheckoutSession({ customerId, priceId, organizationId, trialEnd, successUrl,
 *                           cancelUrl }) → { id, url }
 *   createPortalSession({ customerId, returnUrl }) → { url }
 *   parseWebhook(rawBody, signatureHeader) → { id, type, kind, organizationId, customerId,
 *                                              subscriptionId, invoiceId }  (throws if forged)
 *   getSubscription(id) → { id, customerId, organizationId, status, priceId, trialEnd,
 *                           currentPeriodEnd, cancelAtPeriodEnd }
 *   getInvoice(id) → { id, customerId, subscriptionId, number, status, currency, amountDue,
 *                      amountPaid, periodStart, periodEnd, hostedInvoiceUrl, invoicePdfUrl,
 *                      issuedAt }
 */
export function createBillingProvider({ env }) {
  if (env.BILLING_PROVIDER === 'stripe') {
    return createStripeProvider({
      secretKey: env.STRIPE_SECRET_KEY,
      webhookSecret: env.STRIPE_WEBHOOK_SECRET,
    });
  }
  return null;
}
