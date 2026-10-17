import { z } from 'zod';
import multer from 'multer';
import { moneySchema } from '../../utils/money.js';
import { paginationSchema, slugSchema, uuidSchema } from '../../utils/schemas.js';
import { createCategoryService } from './categories.service.js';
import { PRODUCT_SORTS, createProductService } from './products.service.js';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const optionalText = (max) =>
  z
    .union([z.string().trim().max(max, `Use at most ${max} characters`), z.null()])
    .optional()
    .transform((v) => v || null);

const categoryBody = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(120, 'Use at most 120 characters'),
  slug: slugSchema.optional(),
  parentId: uuidSchema.nullable().optional(),
  description: optionalText(1000),
});

const skuSchema = z
  .string({ error: 'Enter a SKU' })
  .trim()
  .toUpperCase()
  .min(1, 'Enter a SKU')
  .max(64, 'Use at most 64 characters')
  .regex(
    /^[A-Z0-9][A-Z0-9._/-]*$/,
    'Use letters, numbers and . _ / - (start with a letter or number)',
  );

const variantSchema = z.object({
  id: uuidSchema.optional(),
  sku: skuSchema,
  name: z.string().trim().max(120, 'Use at most 120 characters').optional(),
  options: z
    .record(z.string().min(1).max(30), z.string().trim().min(1, 'Enter a value').max(60))
    .default({})
    .refine((o) => Object.keys(o).length <= 5, { error: 'Use at most 5 options' }),
  price: moneySchema,
  cost: moneySchema.nullable().optional(),
  lowStockThreshold: z.coerce.number().int('Use a whole number').min(0).max(1_000_000).default(5),
});

const productStatus = z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED'], { error: 'Choose a status' });

const productBody = z.object({
  name: z.string().trim().min(1, 'Enter a product name').max(200, 'Use at most 200 characters'),
  description: optionalText(5000),
  categoryId: uuidSchema.nullable().optional(),
  status: productStatus.default('DRAFT'),
  variants: z
    .array(variantSchema, { error: 'Add at least one variant' })
    .min(1, 'Add at least one variant')
    .max(100, 'A product can have at most 100 variants'),
});

const productListQuery = paginationSchema.extend({
  search: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((v) => v || undefined),
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED', 'ALL']).optional(),
  categoryId: uuidSchema.optional(),
  sort: z.enum(PRODUCT_SORTS).default('-updatedAt'),
});

const productParams = z.object({ productId: uuidSchema });
const imageParams = z.object({ productId: uuidSchema, imageId: uuidSchema });

export function categoryRoutes(deps) {
  const categories = createCategoryService(deps);
  const params = z.object({ categoryId: uuidSchema });

  return {
    basePath: '/categories',
    routes: [
      {
        method: 'get',
        path: '/',
        access: { permission: 'product:read' },
        handler: (req) => categories.list(req),
      },
      {
        method: 'post',
        path: '/',
        access: { permission: 'product:write' },
        validate: { body: categoryBody },
        status: 201,
        handler: (req) => categories.create(req, req.valid.body),
      },
      {
        method: 'patch',
        path: '/:categoryId',
        access: { permission: 'product:write' },
        validate: {
          params,
          body: categoryBody
            .partial()
            .refine((b) => Object.keys(b).length > 0, { error: 'Nothing to update' }),
        },
        handler: (req) => categories.update(req, req.valid.params.categoryId, req.valid.body),
      },
      {
        method: 'delete',
        path: '/:categoryId',
        access: { permission: 'product:write' },
        validate: { params },
        handler: (req) => categories.remove(req, req.valid.params.categoryId),
      },
    ],
  };
}

export function productRoutes(deps) {
  const products = createProductService(deps);
  // Files are held in memory (at most 5 MB, one file) and checked before anything is stored.
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 2, parts: 3 },
  }).single('file');

  return {
    basePath: '/products',
    routes: [
      {
        method: 'get',
        path: '/',
        access: { permission: 'product:read' },
        validate: { query: productListQuery },
        handler: async (req, res) => {
          res.json(await products.list(req, req.valid.query));
        },
      },
      {
        method: 'post',
        path: '/',
        access: { permission: 'product:write' },
        validate: { body: productBody },
        status: 201,
        handler: (req) => products.create(req, req.valid.body),
      },
      {
        method: 'get',
        path: '/:productId',
        access: { permission: 'product:read' },
        validate: { params: productParams },
        handler: (req) => products.get(req, req.valid.params.productId),
      },
      {
        method: 'put',
        path: '/:productId',
        access: { permission: 'product:write' },
        validate: { params: productParams, body: productBody },
        handler: (req) => products.replace(req, req.valid.params.productId, req.valid.body),
      },
      {
        method: 'patch',
        path: '/:productId/status',
        access: { permission: 'product:write' },
        validate: { params: productParams, body: z.object({ status: productStatus }) },
        handler: (req) =>
          products.setStatus(req, req.valid.params.productId, req.valid.body.status),
      },
      {
        method: 'delete',
        path: '/:productId',
        access: { permission: 'product:write' },
        validate: { params: productParams },
        handler: (req) => products.remove(req, req.valid.params.productId),
      },
      {
        method: 'post',
        path: '/:productId/images',
        access: { permission: 'product:write' },
        afterAuth: [upload],
        validate: { params: productParams },
        status: 201,
        handler: (req) => products.addImage(req, req.valid.params.productId, req.file),
      },
      {
        method: 'patch',
        path: '/:productId/images/:imageId',
        access: { permission: 'product:write' },
        validate: {
          params: imageParams,
          body: z
            .object({ altText: optionalText(300), position: z.number().int().min(0).max(100) })
            .partial()
            .refine((b) => Object.keys(b).length > 0, { error: 'Nothing to update' }),
        },
        handler: (req) =>
          products.updateImage(
            req,
            req.valid.params.productId,
            req.valid.params.imageId,
            req.valid.body,
          ),
      },
      {
        method: 'delete',
        path: '/:productId/images/:imageId',
        access: { permission: 'product:write' },
        validate: { params: imageParams },
        handler: (req) =>
          products.removeImage(req, req.valid.params.productId, req.valid.params.imageId),
      },
      {
        method: 'get',
        path: '/:productId/images/:imageId/file',
        access: { permission: 'product:read' },
        validate: { params: imageParams },
        handler: (req, res) =>
          products.streamImage(req, res, req.valid.params.productId, req.valid.params.imageId),
      },
    ],
  };
}
