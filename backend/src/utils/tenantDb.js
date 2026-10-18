/**
 * Tenant-scoped Prisma client.
 *
 * Every query on a tenant-owned model gets `organizationId = <current tenant>` added to its
 * `where`, and every create gets it in `data`. A query that names a different organization
 * throws instead of being silently rewritten, because that always indicates a bug.
 *
 * The Organization model itself is scoped by `id`. Non-tenant models (User) pass through.
 * Raw SQL ($queryRaw, $executeRaw) is NOT scoped: tenant code must add the filter itself.
 */

export const TENANT_MODELS = new Set([
  'OrganizationMembership',
  'Invitation',
  'OwnershipTransfer',
  'Store',
  'AuditLog',
  'Category',
  'Product',
  'ProductVariant',
  'ProductImage',
  'InventoryLevel',
  'InventoryMovement',
  'Customer',
  'Address',
  'Order',
  'OrderItem',
  'OrderStatusHistory',
  'InventoryReservation',
  'OrganizationCounter',
  'EmailDelivery',
  'NotificationEvent',
  'Notification',
  'Subscription',
  'BillingInvoice',
]);

const WHERE_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
  'upsert',
]);

export class TenantScopeViolation extends Error {
  constructor(message) {
    super(message);
    this.name = 'TenantScopeViolation';
  }
}

function scopeWhere(where, field, organizationId, model) {
  if (where && where[field] !== undefined && where[field] !== organizationId) {
    throw new TenantScopeViolation(`${model}: query names another organization`);
  }
  return { ...where, [field]: organizationId };
}

function scopeData(data, organizationId, model) {
  if (data.organizationId !== undefined && data.organizationId !== organizationId) {
    throw new TenantScopeViolation(`${model}: write names another organization`);
  }
  return { ...data, organizationId };
}

export function tenantDb(prisma, organizationId) {
  if (!organizationId) throw new TenantScopeViolation('tenantDb requires an organization id');

  return prisma.$extends({
    name: 'tenant-scope',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (model === 'Organization') {
            if (operation.startsWith('create')) {
              throw new TenantScopeViolation('Organizations cannot be created in tenant scope');
            }
            if (WHERE_OPERATIONS.has(operation)) {
              args = { ...args, where: scopeWhere(args?.where, 'id', organizationId, model) };
            }
            return query(args);
          }

          if (!TENANT_MODELS.has(model)) return query(args);

          if (WHERE_OPERATIONS.has(operation)) {
            args = {
              ...args,
              where: scopeWhere(args?.where, 'organizationId', organizationId, model),
            };
          }
          if (operation === 'create') {
            args = { ...args, data: scopeData(args.data, organizationId, model) };
          } else if (operation === 'createMany' || operation === 'createManyAndReturn') {
            const rows = Array.isArray(args.data) ? args.data : [args.data];
            args = { ...args, data: rows.map((row) => scopeData(row, organizationId, model)) };
          } else if (operation === 'upsert') {
            args = { ...args, create: scopeData(args.create, organizationId, model) };
          }
          return query(args);
        },
      },
    },
  });
}
