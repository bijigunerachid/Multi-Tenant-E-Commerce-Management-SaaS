import { readFileSync } from 'node:fs';
import { createTestApp } from './helpers/testApp.js';
import { generateOpenApi } from '../src/utils/openapiDocument.js';

const committed = readFileSync(new URL('../../docs/openapi.json', import.meta.url), 'utf8');

test('docs/openapi.json is up to date (run `npm run openapi -w backend` after changing routes)', () => {
  expect(committed).toBe(generateOpenApi());
});

test('every mounted route is documented with its access rule', async () => {
  const ctx = await createTestApp();
  try {
    const doc = JSON.parse(committed);
    for (const route of ctx.app.locals.routeTable) {
      const path = route.path.replace(/:(\w+)/g, '{$1}');
      const operation = doc.paths[path]?.[route.method.toLowerCase()];
      expect({ route: `${route.method} ${route.path}`, documented: Boolean(operation) }).toEqual({
        route: `${route.method} ${route.path}`,
        documented: true,
      });
      if (route.access.permission) {
        expect(operation.description).toContain(route.access.permission);
      }
      if (route.validate?.body) expect(operation.requestBody).toBeDefined();
    }
    expect(doc.paths['/subscriptions/webhooks/stripe'].post.security).toEqual([]);
  } finally {
    await ctx.close();
  }
});
