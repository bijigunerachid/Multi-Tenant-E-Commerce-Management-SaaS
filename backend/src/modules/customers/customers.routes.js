import { z } from 'zod';
import { rateLimit } from '../../middleware/rateLimit.js';
import { emailSchema, paginationSchema, uuidSchema } from '../../utils/schemas.js';
import { CUSTOMER_SORTS, createCustomerService } from './customers.service.js';

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
// Region codes that Intl knows but that are not countries (the frontend list excludes the same).
const NOT_COUNTRIES = new Set(['EU', 'EZ', 'UN', 'QO', 'XA', 'XB', 'ZZ']);

/** Optional text: blank becomes null; absent stays absent (so PATCH leaves it unchanged). */
const optionalText = (max) =>
  z
    .union([z.string().trim().max(max, `Use at most ${max} characters`), z.null()])
    .optional()
    .transform((v) => (v === undefined ? undefined : v || null));

const phone = z
  .union([
    z
      .string()
      .trim()
      .max(40, 'Use at most 40 characters')
      .regex(/^[0-9+()\-.\s]*$/, 'Use digits, spaces and + ( ) - only'),
    z.null(),
  ])
  .optional()
  .transform((v) => (v === undefined ? undefined : v || null));

const country = z
  .string({ error: 'Choose a country' })
  .trim()
  .toUpperCase()
  .refine(
    (code) => /^[A-Z]{2}$/.test(code) && !NOT_COUNTRIES.has(code) && regionNames.of(code) !== code,
    {
      error: 'Choose a valid country',
    },
  );

const addressFields = z.object({
  label: optionalText(60),
  recipientName: optionalText(160),
  line1: z
    .string({ error: 'Enter the street address' })
    .trim()
    .min(1, 'Enter the street address')
    .max(200),
  line2: optionalText(200),
  city: z.string({ error: 'Enter a city' }).trim().min(1, 'Enter a city').max(120),
  region: optionalText(120),
  postalCode: optionalText(20),
  country,
  phone,
  isDefault: z.boolean().optional(),
});

const customerFields = z.object({
  name: z
    .string({ error: 'Enter a name' })
    .trim()
    .min(1, 'Enter a name')
    .max(160, 'Use at most 160 characters'),
  email: z
    .union([emailSchema, z.literal(''), z.null()])
    .optional()
    .transform((v) => (v === undefined ? undefined : v || null)),
  phone,
  notes: optionalText(2000),
});

const listQuery = paginationSchema.extend({
  search: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((v) => v || undefined),
  status: z.enum(['active', 'archived', 'all']).default('active'),
  sort: z.enum(CUSTOMER_SORTS).default('name'),
});

const customerParams = z.object({ customerId: uuidSchema });
const addressParams = z.object({ customerId: uuidSchema, addressId: uuidSchema });
const nonEmpty = { error: 'Nothing to update' };

export function customerRoutes(deps) {
  const customers = createCustomerService(deps);
  const exportLimit = rateLimit({
    redis: deps.redis,
    name: 'customer-export',
    windowSeconds: 3600,
    max: 20,
    key: (req) => req.ctx?.organizationId,
  });

  return {
    basePath: '/customers',
    routes: [
      // Declared before /:customerId so "export" is never read as an id.
      {
        method: 'get',
        path: '/export',
        access: { permission: 'customer:export' },
        afterAuth: [exportLimit],
        validate: { query: listQuery.pick({ search: true, status: true }) },
        handler: (req, res) => customers.exportCsv(req, res, req.valid.query),
      },
      {
        method: 'get',
        path: '/',
        access: { permission: 'customer:read' },
        validate: { query: listQuery },
        handler: async (req, res) => {
          res.json(await customers.list(req, req.valid.query));
        },
      },
      {
        method: 'post',
        path: '/',
        access: { permission: 'customer:write' },
        validate: {
          body: customerFields.extend({
            address: addressFields.omit({ isDefault: true }).optional(),
          }),
        },
        status: 201,
        handler: (req) => customers.create(req, req.valid.body),
      },
      {
        method: 'get',
        path: '/:customerId',
        access: { permission: 'customer:read' },
        validate: { params: customerParams },
        handler: (req) => customers.get(req, req.valid.params.customerId),
      },
      {
        method: 'patch',
        path: '/:customerId',
        access: { permission: 'customer:write' },
        validate: {
          params: customerParams,
          body: customerFields.partial().refine((b) => Object.keys(b).length > 0, nonEmpty),
        },
        handler: (req) => customers.update(req, req.valid.params.customerId, req.valid.body),
      },
      {
        method: 'patch',
        path: '/:customerId/status',
        access: { permission: 'customer:write' },
        validate: { params: customerParams, body: z.object({ archived: z.boolean() }) },
        handler: (req) =>
          customers.setArchived(req, req.valid.params.customerId, req.valid.body.archived),
      },
      {
        method: 'delete',
        path: '/:customerId',
        access: { permission: 'customer:write' },
        validate: { params: customerParams },
        handler: (req) => customers.remove(req, req.valid.params.customerId),
      },
      {
        method: 'post',
        path: '/:customerId/addresses',
        access: { permission: 'customer:write' },
        validate: { params: customerParams, body: addressFields },
        status: 201,
        handler: (req) => customers.addAddress(req, req.valid.params.customerId, req.valid.body),
      },
      {
        method: 'patch',
        path: '/:customerId/addresses/:addressId',
        access: { permission: 'customer:write' },
        validate: {
          params: addressParams,
          body: addressFields.partial().refine((b) => Object.keys(b).length > 0, nonEmpty),
        },
        handler: (req) =>
          customers.updateAddress(
            req,
            req.valid.params.customerId,
            req.valid.params.addressId,
            req.valid.body,
          ),
      },
      {
        method: 'delete',
        path: '/:customerId/addresses/:addressId',
        access: { permission: 'customer:write' },
        validate: { params: addressParams },
        handler: (req) =>
          customers.removeAddress(req, req.valid.params.customerId, req.valid.params.addressId),
      },
    ],
  };
}
