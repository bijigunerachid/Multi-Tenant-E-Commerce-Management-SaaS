import { z } from 'zod';
import { currencySchema, timezoneSchema, uuidSchema } from '../../utils/schemas.js';
import { createStoreService } from './stores.service.js';

const name = z
  .string({ error: 'Enter a store name' })
  .trim()
  .min(1, 'Enter a store name')
  .max(120, 'Use at most 120 characters');
const createBody = z.object({ name, currency: currencySchema, timezone: timezoneSchema });
// The currency cannot change after creation (see stores.service.js).
const updateBody = z
  .object({ name: name.optional(), timezone: timezoneSchema.optional() })
  .strict()
  .refine((b) => b.name !== undefined || b.timezone !== undefined, {
    error: 'Nothing to change',
  });
const params = z.object({ storeId: uuidSchema });

export function storeRoutes() {
  const stores = createStoreService();
  return {
    basePath: '/stores',
    routes: [
      {
        method: 'get',
        path: '/',
        access: { permission: 'org:read' },
        handler: (req) => stores.list(req),
      },
      {
        method: 'post',
        path: '/',
        access: { permission: 'org:update' },
        validate: { body: createBody },
        status: 201,
        handler: (req) => stores.create(req, req.valid.body),
      },
      {
        method: 'patch',
        path: '/:storeId',
        access: { permission: 'org:update' },
        validate: { params, body: updateBody },
        handler: (req) => stores.update(req, req.valid.params.storeId, req.valid.body),
      },
      {
        method: 'post',
        path: '/:storeId/archive',
        access: { permission: 'org:update' },
        // Reduces usage: allowed when the subscription has ended.
        whenInactive: 'allow',
        validate: { params },
        handler: (req) => stores.archive(req, req.valid.params.storeId),
      },
      {
        method: 'post',
        path: '/:storeId/restore',
        access: { permission: 'org:update' },
        validate: { params },
        handler: (req) => stores.restore(req, req.valid.params.storeId),
      },
    ],
  };
}
