/**
 * Records a notification event in the caller's transaction (`tx`), next to the change it
 * describes. The notification worker delivers it after the transaction commits; if the
 * transaction rolls back, the event disappears with it and nobody is notified.
 */
export function recordNotificationEvent(tx, { organizationId, type, payload, actorUserId = null }) {
  return tx.notificationEvent.create({ data: { organizationId, type, payload, actorUserId } });
}
