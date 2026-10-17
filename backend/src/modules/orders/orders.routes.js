import { z } from 'zod';
import { rateLimit } from '../../middleware/rateLimit.js';
import { moneySchema } from '../../utils/money.js';
import { paginationSchema, uuidSchema } from '../../utils/schemas.js';
import { ORDER_SORTS, createOrderService } from './orders.service.js';
import { STATUSES } from './stateMachine.js';

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
const NOT_COUNTRIES = new Set(['EU', 'EZ', 'UN', 'QO', 'XA', 'XB', 'ZZ']);
const text = (max) => z.string().trim().max(max, `Use at most ${max} characters`);
const optionalText = (max) =>
  z
    .union([text(max), z.null()])
    .optional()
    .transform((v) => v || null);

/** An address typed directly on the order (when it is not one of the customer's addresses). */
const inlineAddress = z.object({
  recipientName: optionalText(160),
  line1: text(200).min(1, 'Enter the street address'),
  line2: optionalText(200),
  city: text(120).min(1, 'Enter a city'),
  region: optionalText(120),
  postalCode: optionalText(20),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .refine((c) => /^[A-Z]{2}$/.test(c) && !NOT_COUNTRIES.has(c) && regionNames.of(c) !== c, {
      error: 'Choose a valid country',
    }),
  phone: optionalText(40),
});

const orderBody = z
  .object({
    storeId: uuidSchema.optional(),
    customerId: uuidSchema.nullable().optional(),
    shippingAddressId: uuidSchema.nullable().optional(),
    shippingAddress: inlineAddress.nullable().optional(),
    items: z
      .array(
        z.object({
          variantId: uuidSchema,
          quantity: z.coerce
            .number({ error: 'Enter a quantity' })
            .int('Use a whole number')
            .min(1, 'Enter at least 1')
            .max(100_000, 'Use at most 100000'),
        }),
        { error: 'Add at least one product' },
      )
      .min(1, 'Add at least one product')
      .max(200, 'An order can have at most 200 lines'),
    discountTotal: moneySchema.default('0'),
    shippingTotal: moneySchema.default('0'),
    taxRate: z
      .union([z.string(), z.number()])
      .transform((v) => String(v).trim())
      .refine((v) => /^(0(\.\d{1,4})?|1(\.0{1,4})?)$/.test(v), {
        error: 'Enter a tax rate between 0 and 1, for example 0.2 for 20%',
      })
      .default('0'),
    notes: optionalText(1000),
  })
  .refine((b) => !(b.shippingAddressId && b.shippingAddress), {
    path: ['shippingAddress'],
    error: 'Choose a saved address or enter one, not both',
  });

const dateParam = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .transform((v) => new Date(`${v}T00:00:00.000Z`));

const filters = z.object({
  status: z.enum(STATUSES).optional(),
  customerId: uuidSchema.optional(),
  search: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((v) => v || undefined),
  from: dateParam.optional(),
  // "to" is inclusive for people (2026-10-31 means the whole day), exclusive in the query.
  to: dateParam.optional().transform((d) => (d ? new Date(d.getTime() + 86_400_000) : undefined)),
});

const orderParams = z.object({ orderId: uuidSchema });

export function orderRoutes(deps) {
  const orders = createOrderService(deps);
  const exportLimit = rateLimit({
    redis: deps.redis,
    name: 'order-export',
    windowSeconds: 3600,
    max: 20,
    key: (req) => req.ctx?.organizationId,
  });

  return {
    basePath: '/orders',
    routes: [
      // Fixed paths are declared before /:orderId.
      {
        method: 'get',
        path: '/export',
        access: { permission: 'order:read' },
        afterAuth: [exportLimit],
        validate: { query: filters },
        handler: (req, res) => orders.exportCsv(req, res, req.valid.query),
      },
      {
        method: 'get',
        path: '/sellable-variants',
        access: { permission: 'order:write' },
        validate: {
          query: z.object({
            storeId: uuidSchema.optional(),
            search: z
              .string()
              .trim()
              .max(100)
              .optional()
              .transform((v) => v || undefined),
            limit: z.coerce.number().int().min(1).max(50).default(20),
          }),
        },
        handler: (req) => orders.sellableVariants(req, req.valid.query),
      },
      {
        method: 'get',
        path: '/',
        access: { permission: 'order:read' },
        validate: {
          query: paginationSchema.extend(filters.shape).extend({
            sort: z.enum(ORDER_SORTS).default('-createdAt'),
          }),
        },
        handler: async (req, res) => {
          res.json(await orders.list(req, req.valid.query));
        },
      },
      {
        method: 'post',
        path: '/',
        access: { permission: 'order:write' },
        validate: { body: orderBody },
        status: 201,
        handler: (req) => orders.createDraft(req, req.valid.body),
      },
      {
        method: 'get',
        path: '/:orderId',
        access: { permission: 'order:read' },
        validate: { params: orderParams },
        handler: (req) => orders.get(req, req.valid.params.orderId),
      },
      {
        method: 'put',
        path: '/:orderId',
        access: { permission: 'order:write' },
        validate: { params: orderParams, body: orderBody },
        handler: (req) => orders.updateDraft(req, req.valid.params.orderId, req.valid.body),
      },
      {
        method: 'delete',
        path: '/:orderId',
        access: { permission: 'order:write' },
        validate: { params: orderParams },
        handler: (req) => orders.deleteDraft(req, req.valid.params.orderId),
      },
      {
        method: 'post',
        path: '/:orderId/transitions',
        access: { permission: 'order:transition' },
        validate: {
          params: orderParams,
          body: z.object({
            // Cancelling has its own route and permission.
            action: z.enum(['place', 'confirm', 'start', 'ship', 'deliver'], {
              error: 'Choose an action',
            }),
            note: optionalText(500),
          }),
        },
        handler: (req) =>
          orders.transition(req, req.valid.params.orderId, req.valid.body.action, req.valid.body),
      },
      {
        method: 'post',
        path: '/:orderId/cancel',
        access: { permission: 'order:cancel' },
        validate: {
          params: orderParams,
          body: z.object({ reason: text(500).min(1, 'Give a reason for cancelling') }),
        },
        handler: (req) =>
          orders.transition(req, req.valid.params.orderId, 'cancel', {
            reason: req.valid.body.reason,
          }),
      },
    ],
  };
}
