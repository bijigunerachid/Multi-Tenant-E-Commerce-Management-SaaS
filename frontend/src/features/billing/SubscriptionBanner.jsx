import { Link } from 'react-router';
import { Alert } from '../../components/ui/layout.jsx';
import { daysLeft } from './subscription.js';

const TRIAL_WARNING_DAYS = 7;

/**
 * Tells every member when the organization is read-only, and owners when the trial is about
 * to end or a payment failed. Owners get a link to Billing; others are told who can act.
 */
export function SubscriptionBanner({ subscription, canManageBilling }) {
  if (!subscription) return null;
  const billingLink = canManageBilling ? (
    <Link to="/settings/billing" className="font-medium underline">
      Open Billing
    </Link>
  ) : null;

  if (!subscription.usable) {
    const reason =
      subscription.status === 'CANCELED' ? 'The subscription is canceled' : 'The trial has ended';
    return (
      <div className="mb-4">
        <Alert tone="error" title="This organization is read-only">
          {reason}. You can still view and export data, but not change it.{' '}
          {billingLink ?? 'Ask the owner to choose a plan.'}
        </Alert>
      </div>
    );
  }
  if (!canManageBilling) return null;
  if (subscription.status === 'PAST_DUE') {
    return (
      <div className="mb-4">
        <Alert tone="warning" title="A payment failed">
          Everything keeps working while the payment is retried. {billingLink}
        </Alert>
      </div>
    );
  }
  const days = daysLeft(subscription.trialEndsAt);
  if (subscription.status === 'TRIALING' && days <= TRIAL_WARNING_DAYS) {
    return (
      <div className="mb-4">
        <Alert tone="info">
          Your {subscription.planName} trial ends{' '}
          {days === 0 ? 'today' : `in ${days} ${days === 1 ? 'day' : 'days'}`}. {billingLink}
        </Alert>
      </div>
    );
  }
  return null;
}
