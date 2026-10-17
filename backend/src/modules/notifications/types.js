import { formatMoney } from '../../utils/money.js';
import { lowStockMessage, orderPlacedMessage } from '../../services/emails.js';

/**
 * Notification types. Each one names:
 * - permission: who receives it (active members whose role holds it) and who may see it later.
 *   A member whose role changes stops seeing the notifications their new role would not get;
 * - notifyActor: whether the person who caused it is notified too;
 * - describe(tx, event): the data shown to recipients, read when the event is delivered, or
 *   null when there is nothing left to say (for example, the product was archived meanwhile);
 * - email: the message sent to members who turned on email for this type.
 *
 * describe() runs with the unscoped client inside the worker, so every query filters on the
 * event's organization itself.
 */
export const NOTIFICATION_TYPES = {
  'order.placed': {
    permission: 'order:transition',
    // The person who placed the order does not need to be told about it.
    notifyActor: false,
    emailKind: 'notification.order_placed',
    email: orderPlacedMessage,
    async describe(tx, { organizationId, payload }) {
      // A missing id would turn the lookup into "any order": refuse it instead.
      if (!payload?.orderId) throw new Error('order.placed event without an order id');
      const order = await tx.order.findFirst({
        where: { organizationId, id: payload.orderId },
        include: { store: { select: { name: true } }, items: { select: { quantity: true } } },
      });
      if (!order || order.number === null) return null;
      return {
        orderId: order.id,
        number: order.number,
        total: formatMoney(order.total),
        currency: order.currency,
        itemCount: order.items.reduce((sum, item) => sum + item.quantity, 0),
        storeName: order.store.name,
      };
    },
  },

  'inventory.low_stock': {
    permission: 'inventory:adjust',
    // Stock often drops because of someone else's work (an order reserving it): tell everyone.
    notifyActor: true,
    emailKind: 'notification.low_stock',
    email: lowStockMessage,
    async describe(tx, { organizationId, payload }) {
      if (!payload?.variantId || !payload?.storeId) {
        throw new Error('inventory.low_stock event without a variant or store id');
      }
      const [variant, store] = await Promise.all([
        tx.productVariant.findFirst({
          where: { organizationId, id: payload.variantId },
          include: { product: { select: { id: true, name: true, status: true } } },
        }),
        tx.store.findFirst({ where: { organizationId, id: payload.storeId } }),
      ]);
      if (!variant || !store || variant.product.status === 'ARCHIVED') return null;
      return {
        status: payload.status,
        available: payload.available,
        threshold: payload.threshold,
        variantId: variant.id,
        sku: variant.sku,
        variantName: variant.name,
        productId: variant.product.id,
        productName: variant.product.name,
        storeId: store.id,
        storeName: store.name,
      };
    },
  },
};

export const NOTIFICATION_TYPE_NAMES = Object.keys(NOTIFICATION_TYPES);

/** The notification types a member with these permissions receives and may see. */
export function visibleTypes(permissions) {
  return NOTIFICATION_TYPE_NAMES.filter((type) =>
    permissions.includes(NOTIFICATION_TYPES[type].permission),
  );
}
