import { z } from 'zod';

// Form model ↔ API model for the product editor.
//
// The form holds option *names* once per product (for example "Size", "Color") and each
// variant row holds the values in the same order. The API stores each variant's options as an
// object ({ Size: "M", Color: "Red" }).

export const MAX_OPTIONS = 3;
const MONEY = /^\d{1,10}(\.\d{1,2})?$/;

const variantSchema = z.object({
  id: z.string().optional(),
  optionValues: z.array(z.string().trim().max(60, 'Use at most 60 characters')),
  sku: z
    .string()
    .trim()
    .min(1, 'Enter a SKU')
    .max(64, 'Use at most 64 characters')
    .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/, 'Letters, numbers and . _ / - only'),
  price: z.string().trim().regex(MONEY, 'Enter a price like 19.90'),
  cost: z.union([z.literal(''), z.string().trim().regex(MONEY, 'Enter a cost like 8.50')]),
  lowStockThreshold: z
    .string()
    .trim()
    .regex(/^\d{1,7}$/, 'Enter a whole number'),
});

export const productFormSchema = z
  .object({
    name: z.string().trim().min(1, 'Enter a product name').max(200, 'Use at most 200 characters'),
    description: z.string().max(5000, 'Use at most 5000 characters'),
    categoryId: z.string(),
    status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']),
    optionNames: z.array(z.string().trim().max(30, 'Use at most 30 characters')).max(MAX_OPTIONS),
    variants: z.array(variantSchema).min(1, 'Add at least one variant'),
  })
  .superRefine((form, ctx) => {
    const names = form.optionNames.map((n) => n.trim().toLowerCase()).filter(Boolean);
    form.optionNames.forEach((n, i) => {
      if (
        n.trim() &&
        names.indexOf(n.trim().toLowerCase()) !== names.lastIndexOf(n.trim().toLowerCase())
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['optionNames', i],
          message: 'Option names must be different',
        });
      }
    });
    const seen = new Map();
    form.variants.forEach((v, i) => {
      const sku = v.sku.trim().toUpperCase();
      if (!sku) return;
      if (seen.has(sku))
        ctx.addIssue({
          code: 'custom',
          path: ['variants', i, 'sku'],
          message: 'This SKU is used twice',
        });
      seen.set(sku, i);
    });
  });

export const emptyVariant = (optionCount) => ({
  optionValues: Array.from({ length: optionCount }, () => ''),
  sku: '',
  price: '',
  cost: '',
  lowStockThreshold: '5',
});

export function toFormValues(product) {
  if (!product) {
    return {
      name: '',
      description: '',
      categoryId: '',
      status: 'DRAFT',
      optionNames: [],
      variants: [emptyVariant(0)],
    };
  }
  const optionNames = [];
  for (const v of product.variants) {
    for (const key of Object.keys(v.options ?? {})) {
      if (!optionNames.includes(key) && optionNames.length < MAX_OPTIONS) optionNames.push(key);
    }
  }
  return {
    name: product.name,
    description: product.description ?? '',
    categoryId: product.category?.id ?? '',
    status: product.status,
    optionNames,
    variants: product.variants.map((v) => ({
      id: v.id,
      optionValues: optionNames.map((name) => v.options?.[name] ?? ''),
      sku: v.sku,
      price: v.price,
      cost: v.cost ?? '',
      lowStockThreshold: String(v.lowStockThreshold),
    })),
  };
}

export function toApiBody(values) {
  return {
    name: values.name.trim(),
    description: values.description.trim() || null,
    categoryId: values.categoryId || null,
    status: values.status,
    variants: values.variants.map((v) => ({
      ...(v.id ? { id: v.id } : {}),
      sku: v.sku.trim().toUpperCase(),
      options: Object.fromEntries(
        values.optionNames
          .map((name, i) => [name.trim(), (v.optionValues[i] ?? '').trim()])
          .filter(([name, value]) => name && value),
      ),
      price: v.price.trim(),
      cost: v.cost.trim() || null,
      lowStockThreshold: Number(v.lowStockThreshold),
    })),
  };
}
