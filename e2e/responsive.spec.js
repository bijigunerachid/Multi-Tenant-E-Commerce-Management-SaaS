import { expect, test } from '@playwright/test';
import { apiFromPage, registerAndOnboard, uniqueEmail } from './helpers.js';

// Phone-width layout check. Wide content (tables, variant editors) must scroll inside its own
// container; the page itself must never scroll sideways. This caught two real layout bugs:
// a <fieldset> refusing to shrink, and screen-reader-only labels escaping table scrollers.

test.use({ viewport: { width: 390, height: 844 } });

test('no app page scrolls horizontally on a phone', async ({ page }) => {
  // Realistically long names and emails, so tables are wider than the phone screen.
  await registerAndOnboard(page, {
    name: 'Amina Haddad-Benali El Fassi',
    email: uniqueEmail('amina.haddad-benali.operations'),
    organization: 'Atlas Outfitters',
  });
  const product = await apiFromPage(page, 'POST', '/products', {
    name: 'Linen shirt with a rather long product name for layout testing',
    status: 'ACTIVE',
    variants: [
      {
        sku: 'SHIRT-LINEN-NATURAL-MEDIUM',
        options: { Size: 'M', Color: 'Natural' },
        price: '349.00',
        cost: '120.00',
      },
      {
        sku: 'SHIRT-LINEN-NATURAL-LARGE',
        options: { Size: 'L', Color: 'Natural' },
        price: '369.00',
      },
    ],
  });
  expect(product.status).toBe(201);
  const customer = await apiFromPage(page, 'POST', '/customers', {
    name: 'Amina Haddad-Benali El Fassi',
    email: 'amina.haddad-benali.purchasing@a-rather-long-company-domain.example',
    phone: '+212 600 000 000',
    address: {
      label: 'Head office',
      line1: '1234 Boulevard Mohammed V, Immeuble Al Amal',
      city: 'Casablanca',
      country: 'MA',
    },
  });
  expect(customer.status).toBe(201);
  const order = await apiFromPage(page, 'POST', '/orders', {
    customerId: customer.body.data.id,
    shippingAddressId: customer.body.data.addresses[0].id,
    items: [
      { variantId: product.body.data.variants[0].id, quantity: 2 },
      { variantId: product.body.data.variants[1].id, quantity: 1 },
    ],
    notes: 'Deliver to the loading bay at the back of the building, ring twice.',
  });
  expect(order.status).toBe(201);

  const paths = [
    '/',
    '/products',
    `/products/${product.body.data.id}`,
    '/products/new',
    '/categories',
    '/inventory',
    '/inventory/movements',
    '/customers',
    '/orders',
    '/orders/new',
    `/orders/${order.body.data.id}`,
    `/customers/${customer.body.data.id}`,
    '/reports',
    '/reports?report=products',
    '/reports?report=stores',
    '/employees',
    '/settings/organization',
    '/settings/billing',
    '/settings/emails',
    '/notifications',
    '/settings/profile',
  ];
  for (const path of paths) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    // Measure with the page's data rendered, not its loading skeleton.
    await page.waitForLoadState('networkidle');
    const { contentWidth, visibleWidth } = await page.evaluate(() => ({
      contentWidth: document.documentElement.scrollWidth,
      visibleWidth: document.documentElement.clientWidth,
    }));
    expect({ path, contentWidth }).toEqual({ path, contentWidth: visibleWidth });
  }
});
