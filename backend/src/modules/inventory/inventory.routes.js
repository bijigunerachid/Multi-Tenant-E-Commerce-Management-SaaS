import { z } from 'zod';
import { paginationSchema, uuidSchema } from '../../utils/schemas.js';
import { INVENTORY_SORTS, STOCK_FILTERS, createInventoryService } from './inventory.service.js';

const MAX_QUANTITY = 1_000_000;

const quantity = z.coerce
  .number({ error: 'Enter a quantity' })
  .int('Use a whole number')
  .min(1, 'Enter at least 1')
  .max(MAX_QUANTITY, `Use at most ${MAX_QUANTITY}`);

const note = z
  .string()
  .trim()
  .max(500, 'Use at most 500 characters')
  .optional()
  .transform((v) => v || undefined);

const REASONS = ['COUNT_CORRECTION', 'DAMAGED', 'LOST', 'FOUND', 'RETURNED', 'OTHER'];

const receiptBody = z.object({
  storeId: uuidSchema,
  variantId: uuidSchema,
  quantity,
  note,
});

const adjustmentBody = z
  .object({
    storeId: uuidSchema,
    variantId: uuidSchema,
    change: z.coerce
      .number()
      .int('Use a whole number')
      .min(-MAX_QUANTITY)
      .max(MAX_QUANTITY)
      .refine((v) => v !== 0, { error: 'Enter a change other than 0' })
      .optional(),
    setTo: z.coerce
      .number()
      .int('Use a whole number')
      .min(0, 'Use 0 or more')
      .max(MAX_QUANTITY)
      .optional(),
    reason: z.enum(REASONS, { error: 'Choose a reason' }),
    note,
  })
  .superRefine((body, ctx) => {
    if ((body.change === undefined) === (body.setTo === undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: ['change'],
        message: 'Enter either a change or a counted quantity',
      });
    }
    if (body.reason === 'OTHER' && !body.note) {
      ctx.addIssue({ code: 'custom', path: ['note'], message: 'Explain the adjustment' });
    }
  });

const listQuery = paginationSchema.extend({
  storeId: uuidSchema.optional(),
  categoryId: uuidSchema.optional(),
  search: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((v) => v || undefined),
  stock: z.enum(STOCK_FILTERS).optional(),
  sort: z.enum(INVENTORY_SORTS).default('product'),
  includeArchived: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

const movementQuery = paginationSchema.extend({
  storeId: uuidSchema.optional(),
  variantId: uuidSchema.optional(),
  type: z.enum(['RECEIPT', 'ADJUSTMENT', 'RESERVE', 'RELEASE', 'FULFIL']).optional(),
});

export function inventoryRoutes(deps) {
  const inventory = createInventoryService(deps);

  return {
    basePath: '/inventory',
    routes: [
      {
        method: 'get',
        path: '/',
        access: { permission: 'inventory:read' },
        validate: { query: listQuery },
        handler: async (req, res) => {
          res.json(await inventory.list(req, req.valid.query));
        },
      },
      {
        method: 'get',
        path: '/summary',
        access: { permission: 'inventory:read' },
        validate: { query: z.object({ storeId: uuidSchema.optional() }) },
        handler: (req) => inventory.summary(req, req.valid.query),
      },
      {
        method: 'get',
        path: '/movements',
        access: { permission: 'inventory:read' },
        validate: { query: movementQuery },
        handler: async (req, res) => {
          res.json(await inventory.movements(req, req.valid.query));
        },
      },
      {
        method: 'get',
        path: '/variants/:variantId',
        access: { permission: 'inventory:read' },
        validate: { params: z.object({ variantId: uuidSchema }) },
        handler: (req) => inventory.variantLevels(req, req.valid.params.variantId),
      },
      {
        method: 'post',
        path: '/receipts',
        access: { permission: 'inventory:adjust' },
        validate: { body: receiptBody },
        status: 201,
        handler: (req) => inventory.receive(req, req.valid.body),
      },
      {
        method: 'post',
        path: '/adjustments',
        access: { permission: 'inventory:adjust' },
        validate: { body: adjustmentBody },
        status: 201,
        handler: (req) => inventory.adjust(req, req.valid.body),
      },
    ],
  };
}
