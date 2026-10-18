import { z } from 'zod';
import { PERMISSIONS } from '../modules/auth/permissions.js';

// Builds the OpenAPI 3.1 document from the live route table (src/utils/routes.js), so every
// mounted route is documented with the same access rule and Zod schemas the API enforces.
// `npm run openapi -w backend` writes it to docs/openapi.json; a test fails if that file is
// out of date.

const ERROR_RESPONSES = {
  400: 'The request is invalid (details.fieldErrors names each field)',
  401: 'Not signed in',
  402: 'The subscription or plan does not allow this',
  403: 'Signed in, but not allowed (role, organization or CSRF check)',
  404: 'Not found, or belongs to another organization',
  409: 'Conflicts with the current state',
  429: 'Too many requests (Retry-After says when to try again)',
};

const jsonSchema = (schema) => {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema, {
    io: 'input',
    unrepresentable: 'any',
  });
  return rest;
};

/** Turns a Zod object for params or query into OpenAPI parameters. */
function parameters(schema, location) {
  if (!schema) return [];
  const { properties = {}, required = [] } = jsonSchema(schema);
  return Object.entries(properties).map(([name, prop]) => ({
    name,
    in: location,
    required: location === 'path' || required.includes(name),
    schema: prop,
  }));
}

function describeAccess(access) {
  if (access === 'public') return { security: [], note: 'Public.' };
  if (access === 'authenticated') {
    return { security: [{ session: [], csrf: [] }], note: 'Any signed-in user.' };
  }
  if (access.platform) {
    return {
      security: [{ session: [], csrf: [] }],
      note: 'Vendora platform administrators only.',
    };
  }
  return {
    security: [{ session: [], csrf: [] }],
    note: `Members of the active organization whose role has \`${access.permission}\`.`,
  };
}

export function buildOpenApi(routeTable, { version }) {
  const paths = {};
  for (const route of routeTable) {
    const path = route.path.replace(/:(\w+)/g, '{$1}');
    const method = route.method.toLowerCase();
    const { security, note } = describeAccess(route.access);
    const tag = route.path.split('/')[1];
    const success = String(route.status ?? (method === 'delete' ? 204 : 200));
    const notes = [note];
    if (route.feature) notes.push(`Needs the plan feature \`${route.feature}\`.`);
    if (route.access.permission && route.whenInactive === 'allow') {
      notes.push('Allowed while the subscription is inactive (read-only mode).');
    } else if (route.access.permission && method !== 'get') {
      notes.push('Refused with 402 while the subscription is inactive.');
    }

    const operation = {
      tags: [tag],
      summary: route.summary ?? `${route.method} ${route.path}`,
      description: notes.join(' '),
      security,
      parameters: [
        ...parameters(route.validate?.params, 'path'),
        ...parameters(route.validate?.query, 'query'),
      ],
      responses: {
        [success]:
          success === '204'
            ? { description: 'Done' }
            : {
                description: 'Success',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/Data' } } },
              },
        ...Object.fromEntries(
          Object.entries(ERROR_RESPONSES)
            .filter(([code]) => {
              if (route.access === 'public') return !['401', '403', '402'].includes(code);
              return true;
            })
            .map(([code, description]) => [
              code,
              {
                description,
                content: {
                  'application/json': { schema: { $ref: '#/components/schemas/Error' } },
                },
              },
            ]),
        ),
      },
    };
    // Path parameters that are in the URL but not validated still need declaring.
    for (const [, name] of route.path.matchAll(/:(\w+)/g)) {
      if (!operation.parameters.some((p) => p.in === 'path' && p.name === name)) {
        operation.parameters.push({ name, in: 'path', required: true, schema: { type: 'string' } });
      }
    }
    if (route.validate?.body) {
      operation.requestBody = {
        required: true,
        content: { 'application/json': { schema: jsonSchema(route.validate.body) } },
      };
    }
    if (operation.parameters.length === 0) delete operation.parameters;
    paths[path] ??= {};
    paths[path][method] = operation;
  }

  // Not in the route table: mounted before the session middleware, authenticated by signature.
  paths['/subscriptions/webhooks/stripe'] = {
    post: {
      tags: ['subscriptions'],
      summary: 'Stripe webhook',
      description:
        'Called by Stripe only. Authenticated by the Stripe-Signature header over the raw body; answers 400 to a bad signature and 5xx so Stripe retries a failed event.',
      security: [],
      parameters: [
        { name: 'Stripe-Signature', in: 'header', required: true, schema: { type: 'string' } },
      ],
      requestBody: { required: true, content: { 'application/json': { schema: {} } } },
      responses: { 200: { description: 'Stored and applied, or a recognised duplicate' } },
    },
  };

  return {
    openapi: '3.1.0',
    info: {
      title: 'Vendora API',
      version,
      description: [
        'Multi-tenant back office for independent shops.',
        '',
        'Authentication: a session cookie set by `POST /auth/login`. Every request that changes',
        'something also sends the session CSRF token in `X-CSRF-Token` (returned in each session',
        'payload). The organization is the one active in the session, never a request field.',
        '',
        'Successful responses are `{ "data": ... }` (lists add `meta`); errors are',
        '`{ "error": { "code", "message", "details", "requestId" } }`.',
        '',
        `Permissions: ${PERMISSIONS.map((p) => `\`${p}\``).join(', ')}.`,
      ].join('\n'),
    },
    servers: [{ url: '/api/v1' }],
    components: {
      securitySchemes: {
        session: {
          type: 'apiKey',
          in: 'cookie',
          name: '__Host-vendora_session',
          description: 'HttpOnly session cookie (named vendora_session in development).',
        },
        csrf: { type: 'apiKey', in: 'header', name: 'X-CSRF-Token' },
      },
      schemas: {
        Data: {
          type: 'object',
          properties: { data: {}, meta: { type: 'object' } },
          required: ['data'],
        },
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: {
                code: { type: 'string' },
                message: { type: 'string' },
                details: { type: 'object' },
                requestId: { type: 'string' },
              },
              required: ['code', 'message'],
            },
          },
          required: ['error'],
        },
      },
    },
    paths: Object.fromEntries(Object.entries(paths).sort(([a], [b]) => a.localeCompare(b))),
  };
}
