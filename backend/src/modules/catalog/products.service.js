import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { AppError, conflict, notFound, isUniqueViolation } from '../../utils/errors.js';
import { recordAudit } from '../../utils/audit.js';
import { formatMoney } from '../../utils/money.js';
import { assertWithinLimit } from '../billing/limits.js';
import { detectImageType } from '../../utils/imageType.js';

export const MAX_IMAGES_PER_PRODUCT = 10;

const SORTS = {
  name: { name: 'asc' },
  '-name': { name: 'desc' },
  createdAt: { createdAt: 'asc' },
  '-createdAt': { createdAt: 'desc' },
  updatedAt: { updatedAt: 'asc' },
  '-updatedAt': { updatedAt: 'desc' },
};
export const PRODUCT_SORTS = Object.keys(SORTS);

const validation = (fieldErrors) =>
  new AppError(400, 'VALIDATION_FAILED', 'Some fields are invalid', { fieldErrors });

const isForeignKeyViolation = (err) => err?.code === 'P2003';
const hasHistory = () =>
  conflict(
    'PRODUCT_HAS_HISTORY',
    'This product has stock or order history and cannot be deleted. Archive it instead.',
  );

const imageUrl = (productId, imageId) => `/api/v1/products/${productId}/images/${imageId}/file`;

function variantName(variant) {
  if (variant.name) return variant.name;
  const values = Object.values(variant.options ?? {});
  return values.length ? values.join(' / ') : 'Default';
}

function presentVariant(v) {
  return {
    id: v.id,
    sku: v.sku,
    name: v.name,
    options: v.options,
    price: formatMoney(v.price),
    cost: formatMoney(v.cost),
    currency: v.currency,
    lowStockThreshold: v.lowStockThreshold,
    position: v.position,
  };
}

function presentImage(img) {
  return {
    id: img.id,
    url: imageUrl(img.productId, img.id),
    mimeType: img.mimeType,
    sizeBytes: img.sizeBytes,
    altText: img.altText,
    position: img.position,
  };
}

function presentProduct(p) {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    status: p.status,
    category: p.category ? { id: p.category.id, name: p.category.name } : null,
    variants: p.variants.map(presentVariant),
    images: p.images.map(presentImage),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

function presentListItem(p) {
  const prices = p.variants.map((v) => v.price);
  const min = prices.reduce((a, b) => (b.lessThan(a) ? b : a), prices[0]);
  const max = prices.reduce((a, b) => (b.greaterThan(a) ? b : a), prices[0]);
  return {
    id: p.id,
    name: p.name,
    status: p.status,
    category: p.category ? { id: p.category.id, name: p.category.name } : null,
    variantCount: p.variants.length,
    skus: p.variants.slice(0, 3).map((v) => v.sku),
    priceMin: formatMoney(min),
    priceMax: formatMoney(max),
    currency: p.variants[0]?.currency ?? null,
    image: p.images[0] ? presentImage(p.images[0]) : null,
    updatedAt: p.updatedAt,
  };
}

const DETAIL_INCLUDE = {
  category: { select: { id: true, name: true } },
  variants: { orderBy: { position: 'asc' } },
  images: { orderBy: { position: 'asc' } },
};

export function createProductService({ storage, logger }) {
  async function loadProduct(db, productId) {
    const product = await db.product.findUnique({
      where: { id: productId },
      include: DETAIL_INCLUDE,
    });
    if (!product) throw notFound('Product not found');
    return product;
  }

  async function assertCategory(db, categoryId) {
    if (!categoryId) return;
    const category = await db.category.findUnique({
      where: { id: categoryId },
      select: { id: true },
    });
    if (!category) throw validation({ categoryId: 'Choose a valid category' });
  }

  /**
   * SKUs must be unique within the organization. Reports duplicates inside the request and
   * clashes with other products as field errors on the exact variant row.
   */
  async function assertSkusAvailable(db, variants, productId) {
    const errors = {};
    const seen = new Map();
    variants.forEach((v, i) => {
      if (seen.has(v.sku)) errors[`variants.${i}.sku`] = 'This SKU is used twice in this product';
      seen.set(v.sku, i);
    });
    const taken = await db.productVariant.findMany({
      where: {
        sku: { in: [...seen.keys()] },
        ...(productId ? { productId: { not: productId } } : {}),
      },
      select: { sku: true },
    });
    for (const { sku } of taken)
      errors[`variants.${seen.get(sku)}.sku`] = 'This SKU is already used by another product';
    if (Object.keys(errors).length) {
      throw new AppError(409, 'SKU_TAKEN', 'Some SKUs are already in use', { fieldErrors: errors });
    }
  }

  // An archived product does not count against the plan; bringing one back does.
  const leavesArchive = (from, to) => from === 'ARCHIVED' && to !== 'ARCHIVED';
  const statusFields = (status) => ({
    status,
    archivedAt: status === 'ARCHIVED' ? new Date() : null,
  });

  return {
    async list(req, { page, pageSize, search, status, categoryId, sort }) {
      const where = {};
      if (status === 'ALL') {
        // no status filter
      } else if (status) {
        where.status = status;
      } else {
        where.status = { not: 'ARCHIVED' };
      }
      if (categoryId) where.categoryId = categoryId;
      if (search) {
        where.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { variants: { some: { sku: { contains: search, mode: 'insensitive' } } } },
        ];
      }

      const [rows, total] = await Promise.all([
        req.db.product.findMany({
          where,
          orderBy: [SORTS[sort], { id: 'asc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: {
            category: { select: { id: true, name: true } },
            variants: {
              orderBy: { position: 'asc' },
              select: { sku: true, price: true, currency: true },
            },
            images: { orderBy: { position: 'asc' }, take: 1 },
          },
        }),
        req.db.product.count({ where }),
      ]);
      return { data: rows.map(presentListItem), meta: { page, pageSize, total } };
    },

    async get(req, productId) {
      return presentProduct(await loadProduct(req.db, productId));
    },

    async create(req, input) {
      await assertCategory(req.db, input.categoryId);
      await assertSkusAvailable(req.db, input.variants);
      const { defaultCurrency } = await req.db.organization.findFirstOrThrow();

      try {
        const productId = await req.db.$transaction(async (tx) => {
          if (input.status !== 'ARCHIVED') await assertWithinLimit(tx, req.ctx, 'products');
          const product = await tx.product.create({
            data: {
              name: input.name,
              description: input.description ?? null,
              categoryId: input.categoryId ?? null,
              ...statusFields(input.status),
            },
          });
          await tx.productVariant.createMany({
            data: input.variants.map((v, position) => ({
              productId: product.id,
              sku: v.sku,
              name: variantName(v),
              options: v.options,
              price: v.price,
              cost: v.cost ?? null,
              currency: defaultCurrency,
              lowStockThreshold: v.lowStockThreshold,
              position,
            })),
          });
          await recordAudit(tx, req, {
            action: 'product.created',
            entityType: 'Product',
            entityId: product.id,
            metadata: { name: product.name, variants: input.variants.length },
          });
          return product.id;
        });
        return presentProduct(await loadProduct(req.db, productId));
      } catch (err) {
        // A concurrent request can take a SKU between the check above and the insert.
        if (isUniqueViolation(err)) throw conflict('SKU_TAKEN', 'Some SKUs are already in use');
        throw err;
      }
    },

    /**
     * Replaces the product's details and variant list in one transaction. Variants with an id
     * are updated, without an id are created, and missing ones are deleted (refused with 409
     * once they have stock or order history).
     */
    async replace(req, productId, input) {
      const existing = await loadProduct(req.db, productId);
      const existingIds = new Set(existing.variants.map((v) => v.id));
      const errors = {};
      input.variants.forEach((v, i) => {
        if (v.id && !existingIds.has(v.id))
          errors[`variants.${i}.id`] = 'This variant does not belong to the product';
      });
      if (Object.keys(errors).length) throw validation(errors);
      await assertCategory(req.db, input.categoryId);
      await assertSkusAvailable(req.db, input.variants, productId);

      const keptIds = new Set(input.variants.filter((v) => v.id).map((v) => v.id));
      const removedIds = [...existingIds].filter((id) => !keptIds.has(id));
      const currency =
        existing.variants[0]?.currency ??
        (await req.db.organization.findFirstOrThrow()).defaultCurrency;

      try {
        await req.db.$transaction(async (tx) => {
          if (leavesArchive(existing.status, input.status)) {
            await assertWithinLimit(tx, req.ctx, 'products');
          }
          await tx.product.update({
            where: { id: productId },
            data: {
              name: input.name,
              description: input.description ?? null,
              categoryId: input.categoryId ?? null,
              ...(input.status !== existing.status ? statusFields(input.status) : {}),
            },
          });
          if (removedIds.length) {
            await tx.productVariant.deleteMany({ where: { id: { in: removedIds }, productId } });
          }
          // Two passes so variants of this product can swap SKUs without hitting the unique index.
          const updates = input.variants
            .map((v, position) => ({ v, position }))
            .filter(({ v }) => v.id);
          for (const { v } of updates) {
            await tx.productVariant.update({
              where: { id: v.id },
              data: { sku: `TMP-${randomUUID().toUpperCase()}` },
            });
          }
          for (const { v, position } of updates) {
            await tx.productVariant.update({
              where: { id: v.id },
              data: {
                sku: v.sku,
                name: variantName(v),
                options: v.options,
                price: v.price,
                cost: v.cost ?? null,
                lowStockThreshold: v.lowStockThreshold,
                position,
              },
            });
          }
          const created = input.variants
            .map((v, position) => ({ v, position }))
            .filter(({ v }) => !v.id);
          if (created.length) {
            await tx.productVariant.createMany({
              data: created.map(({ v, position }) => ({
                productId,
                sku: v.sku,
                name: variantName(v),
                options: v.options,
                price: v.price,
                cost: v.cost ?? null,
                currency,
                lowStockThreshold: v.lowStockThreshold,
                position,
              })),
            });
          }
          await recordAudit(tx, req, {
            action: 'product.updated',
            entityType: 'Product',
            entityId: productId,
            metadata: { variantsRemoved: removedIds.length, variantsAdded: created.length },
          });
        });
      } catch (err) {
        if (isForeignKeyViolation(err)) {
          throw conflict(
            'VARIANT_HAS_HISTORY',
            'A removed variant has stock or order history. Keep it instead.',
          );
        }
        if (isUniqueViolation(err)) throw conflict('SKU_TAKEN', 'Some SKUs are already in use');
        throw err;
      }
      return presentProduct(await loadProduct(req.db, productId));
    },

    async setStatus(req, productId, status) {
      const existing = await req.db.product.findUnique({ where: { id: productId } });
      if (!existing) throw notFound('Product not found');
      if (existing.status !== status) {
        await req.db.$transaction(async (tx) => {
          if (leavesArchive(existing.status, status)) {
            await assertWithinLimit(tx, req.ctx, 'products');
          }
          await tx.product.update({ where: { id: productId }, data: statusFields(status) });
          await recordAudit(tx, req, {
            action: 'product.status_changed',
            entityType: 'Product',
            entityId: productId,
            metadata: { from: existing.status, to: status },
          });
        });
      }
      return presentProduct(await loadProduct(req.db, productId));
    },

    async remove(req, productId) {
      const product = await loadProduct(req.db, productId);
      try {
        await req.db.$transaction(async (tx) => {
          await tx.product.delete({ where: { id: productId } });
          await recordAudit(tx, req, {
            action: 'product.deleted',
            entityType: 'Product',
            entityId: productId,
            metadata: { name: product.name, skus: product.variants.map((v) => v.sku) },
          });
        });
      } catch (err) {
        if (isForeignKeyViolation(err)) throw hasHistory();
        throw err;
      }
      // Files are removed after the rows are gone; a leftover file is harmless, a missing one is not.
      await Promise.allSettled(product.images.map((img) => storage.remove(img.storageKey)));
    },

    async addImage(req, productId, file) {
      const product = await req.db.product.findUnique({
        where: { id: productId },
        include: {
          _count: { select: { images: true } },
          images: { orderBy: { position: 'desc' }, take: 1 },
        },
      });
      if (!product) throw notFound('Product not found');
      if (!file) throw validation({ file: 'Choose an image to upload' });
      const type = detectImageType(file.buffer);
      if (!type) throw validation({ file: 'Upload a JPEG, PNG or WebP image' });
      if (product._count.images >= MAX_IMAGES_PER_PRODUCT) {
        throw conflict(
          'TOO_MANY_IMAGES',
          `A product can have at most ${MAX_IMAGES_PER_PRODUCT} images`,
        );
      }

      const storageKey = `${req.ctx.organizationId}/${randomUUID()}.${type.extension}`;
      await storage.put(storageKey, file.buffer);
      try {
        const image = await req.db.productImage.create({
          data: {
            productId,
            storageKey,
            mimeType: type.mimeType,
            sizeBytes: file.buffer.length,
            position: (product.images[0]?.position ?? -1) + 1,
          },
        });
        return presentImage(image);
      } catch (err) {
        await storage
          .remove(storageKey)
          .catch((e) => logger.warn({ err: e }, 'Could not remove orphan upload'));
        throw err;
      }
    },

    async updateImage(req, productId, imageId, changes) {
      const image = await req.db.productImage.findFirst({ where: { id: imageId, productId } });
      if (!image) throw notFound('Image not found');
      return presentImage(
        await req.db.productImage.update({ where: { id: imageId }, data: changes }),
      );
    },

    async removeImage(req, productId, imageId) {
      const image = await req.db.productImage.findFirst({ where: { id: imageId, productId } });
      if (!image) throw notFound('Image not found');
      await req.db.productImage.delete({ where: { id: imageId } });
      await storage
        .remove(image.storageKey)
        .catch((e) => logger.warn({ err: e }, 'Could not remove image file'));
    },

    /** Streams an image to an authorized member of the owning organization. */
    async streamImage(req, res, productId, imageId) {
      const image = await req.db.productImage.findFirst({ where: { id: imageId, productId } });
      if (!image) throw notFound('Image not found');
      res.setHeader('Content-Type', image.mimeType);
      res.setHeader('Content-Length', String(image.sizeBytes));
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.setHeader('Content-Disposition', 'inline');
      await pipeline(storage.read(image.storageKey), res);
    },
  };
}
