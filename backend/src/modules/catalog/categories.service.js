import { AppError, conflict, notFound, isUniqueViolation } from '../../utils/errors.js';
import { recordAudit } from '../../utils/audit.js';
import { slugify } from '../../utils/schemas.js';

const fieldError = (field, message) =>
  new AppError(400, 'VALIDATION_FAILED', 'Some fields are invalid', {
    fieldErrors: { [field]: message },
  });

function presentCategory(c) {
  return {
    id: c.id,
    name: c.name,
    slug: c.slug,
    parentId: c.parentId,
    description: c.description,
    productCount: c._count?.products ?? 0,
    childCount: c._count?.children ?? 0,
  };
}

export function createCategoryService() {
  /** The parent must exist in this organization and must not be the category or its descendant. */
  async function assertValidParent(db, parentId, categoryId) {
    if (!parentId) return;
    let current = await db.category.findUnique({
      where: { id: parentId },
      select: { id: true, parentId: true },
    });
    if (!current) throw fieldError('parentId', 'Choose a valid parent category');
    for (let depth = 0; current; depth += 1) {
      if (current.id === categoryId)
        throw fieldError('parentId', 'A category cannot be inside itself');
      if (depth > 50) throw fieldError('parentId', 'Categories are nested too deeply');
      current = current.parentId
        ? await db.category.findUnique({
            where: { id: current.parentId },
            select: { id: true, parentId: true },
          })
        : null;
    }
  }

  const slugTaken = () =>
    conflict('SLUG_TAKEN', 'A category with this address already exists', {
      fieldErrors: { slug: 'A category with this address already exists' },
    });

  return {
    async list(req) {
      const categories = await req.db.category.findMany({
        include: { _count: { select: { products: true, children: true } } },
        orderBy: { name: 'asc' },
      });
      return categories.map(presentCategory);
    },

    async create(req, input) {
      await assertValidParent(req.db, input.parentId, null);
      const slug = input.slug ?? (slugify(input.name) || 'category');
      try {
        const category = await req.db.category.create({
          data: {
            name: input.name,
            slug,
            parentId: input.parentId ?? null,
            description: input.description ?? null,
          },
          include: { _count: { select: { products: true, children: true } } },
        });
        return presentCategory(category);
      } catch (err) {
        if (isUniqueViolation(err)) throw slugTaken();
        throw err;
      }
    },

    async update(req, categoryId, changes) {
      const existing = await req.db.category.findUnique({ where: { id: categoryId } });
      if (!existing) throw notFound('Category not found');
      if (changes.parentId !== undefined)
        await assertValidParent(req.db, changes.parentId, categoryId);
      try {
        const category = await req.db.category.update({
          where: { id: categoryId },
          data: changes,
          include: { _count: { select: { products: true, children: true } } },
        });
        return presentCategory(category);
      } catch (err) {
        if (isUniqueViolation(err)) throw slugTaken();
        throw err;
      }
    },

    async remove(req, categoryId) {
      const category = await req.db.category.findUnique({
        where: { id: categoryId },
        include: { _count: { select: { products: true, children: true } } },
      });
      if (!category) throw notFound('Category not found');
      if (category._count.products > 0 || category._count.children > 0) {
        throw conflict(
          'CATEGORY_IN_USE',
          'Move its products and sub-categories to another category before deleting it',
          { productCount: category._count.products, childCount: category._count.children },
        );
      }
      await req.db.$transaction(async (tx) => {
        await tx.category.delete({ where: { id: categoryId } });
        await recordAudit(tx, req, {
          action: 'category.deleted',
          entityType: 'Category',
          entityId: categoryId,
          metadata: { name: category.name },
        });
      });
    },
  };
}
