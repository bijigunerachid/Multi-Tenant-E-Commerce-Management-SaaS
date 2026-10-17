import { describe, expect, test } from 'vitest';
import { productFormSchema, toApiBody, toFormValues } from './productForm.js';

const apiProduct = {
  id: 'p1',
  name: 'Linen shirt',
  description: null,
  status: 'ACTIVE',
  category: { id: 'c1', name: 'Shirts' },
  variants: [
    {
      id: 'v1',
      sku: 'SHIRT-M-SAND',
      options: { Size: 'M', Color: 'Sand' },
      price: '29.90',
      cost: '12.00',
      lowStockThreshold: 5,
    },
    {
      id: 'v2',
      sku: 'SHIRT-L',
      options: { Size: 'L' },
      price: '31.90',
      cost: null,
      lowStockThreshold: 2,
    },
  ],
  images: [],
};

describe('product form model', () => {
  test('round-trips an API product through the form without losing data', () => {
    const form = toFormValues(apiProduct);
    expect(form.optionNames).toEqual(['Size', 'Color']);
    expect(form.variants[1]).toMatchObject({
      optionValues: ['L', ''],
      cost: '',
      lowStockThreshold: '2',
    });

    expect(toApiBody(form)).toEqual({
      name: 'Linen shirt',
      description: null,
      categoryId: 'c1',
      status: 'ACTIVE',
      variants: [
        {
          id: 'v1',
          sku: 'SHIRT-M-SAND',
          options: { Size: 'M', Color: 'Sand' },
          price: '29.90',
          cost: '12.00',
          lowStockThreshold: 5,
        },
        {
          id: 'v2',
          sku: 'SHIRT-L',
          options: { Size: 'L' },
          price: '31.90',
          cost: null,
          lowStockThreshold: 2,
        },
      ],
    });
  });

  test('upper-cases SKUs and keeps prices as strings', () => {
    const body = toApiBody({
      ...toFormValues(null),
      name: ' Mug ',
      variants: [
        { optionValues: [], sku: ' mug-1 ', price: '9.5', cost: '', lowStockThreshold: '0' },
      ],
    });
    expect(body.variants[0]).toEqual({
      sku: 'MUG-1',
      options: {},
      price: '9.5',
      cost: null,
      lowStockThreshold: 0,
    });
  });

  test('flags duplicate SKUs and duplicate option names on the exact field', () => {
    const result = productFormSchema.safeParse({
      ...toFormValues(null),
      name: 'Shirt',
      optionNames: ['Size', 'size'],
      variants: [
        { optionValues: ['M', ''], sku: 'A-1', price: '1', cost: '', lowStockThreshold: '5' },
        { optionValues: ['L', ''], sku: 'a-1', price: '1.999', cost: '', lowStockThreshold: '5' },
      ],
    });
    const paths = result.error.issues.map((i) => i.path.join('.'));
    expect(paths).toEqual(
      expect.arrayContaining(['optionNames.1', 'variants.1.sku', 'variants.1.price']),
    );
  });
});
