import { z } from 'zod';
import { rateLimit } from '../../middleware/rateLimit.js';
import {
  currencySchema,
  emailSchema,
  nameSchema,
  slugSchema,
  timezoneSchema,
  uuidSchema,
} from '../../utils/schemas.js';
import { createOrganizationService } from './organizations.service.js';

const phoneSchema = z
  .string()
  .trim()
  .max(40, 'Use at most 40 characters')
  .regex(/^[0-9+()\-.\s]*$/, 'Use digits, spaces and + ( ) - only');

export function organizationRoutes(deps) {
  const orgs = createOrganizationService(deps);
  const createLimit = rateLimit({
    redis: deps.redis,
    name: 'org-create',
    windowSeconds: 3600,
    max: 5,
    key: (req) => req.session?.userId ?? req.ip,
  });

  return {
    basePath: '/organizations',
    routes: [
      {
        method: 'get',
        path: '/',
        access: 'authenticated',
        handler: async (req) => {
          const memberships = await deps.prisma.organizationMembership.findMany({
            where: { userId: req.user.id, status: 'ACTIVE' },
            include: { organization: true },
            orderBy: { createdAt: 'asc' },
          });
          return memberships.map((m) => ({
            id: m.organization.id,
            name: m.organization.name,
            slug: m.organization.slug,
            status: m.organization.status,
            role: m.role,
          }));
        },
      },
      {
        method: 'post',
        path: '/',
        access: 'authenticated',
        rateLimit: [createLimit],
        validate: {
          body: z.object({
            name: nameSchema,
            slug: slugSchema.optional(),
            defaultCurrency: currencySchema,
            timezone: timezoneSchema,
            storeName: nameSchema,
          }),
        },
        status: 201,
        handler: (req) => orgs.create(req, req.valid.body),
      },
      {
        method: 'post',
        path: '/:organizationId/switch',
        access: 'authenticated',
        validate: { params: z.object({ organizationId: uuidSchema }) },
        handler: (req) => orgs.switchTo(req, req.valid.params.organizationId),
      },
      {
        method: 'get',
        path: '/current',
        access: { permission: 'org:read' },
        handler: (req) => orgs.getCurrent(req),
      },
      {
        method: 'patch',
        path: '/current',
        access: { permission: 'org:update' },
        whenInactive: 'allow',
        validate: {
          body: z
            .object({
              name: nameSchema,
              defaultCurrency: currencySchema,
              timezone: timezoneSchema,
              contactEmail: z
                .union([emailSchema, z.literal(''), z.null()])
                .transform((v) => v || null),
              contactPhone: z.union([phoneSchema, z.null()]).transform((v) => v || null),
            })
            .partial()
            .refine((body) => Object.keys(body).length > 0, { error: 'Nothing to update' }),
        },
        handler: (req) => orgs.updateCurrent(req, req.valid.body),
      },
      {
        method: 'get',
        path: '/current/ownership-transfer',
        access: { permission: 'org:read' },
        handler: async (req) => ({ transfer: await orgs.getTransfer(req) }),
      },
      {
        method: 'post',
        path: '/current/ownership-transfer',
        access: { permission: 'org:transfer_ownership' },
        whenInactive: 'allow',
        validate: {
          body: z.object({
            toMembershipId: uuidSchema,
            password: z.string().min(1, 'Enter your password').max(128),
          }),
        },
        status: 201,
        handler: async (req) => ({ transfer: await orgs.startTransfer(req, req.valid.body) }),
      },
      {
        method: 'delete',
        path: '/current/ownership-transfer',
        access: { permission: 'org:transfer_ownership' },
        whenInactive: 'allow',
        handler: (req) => orgs.cancelTransfer(req),
      },
      {
        method: 'post',
        path: '/current/ownership-transfer/accept',
        access: { permission: 'org:read' },
        whenInactive: 'allow',
        handler: (req) => orgs.acceptTransfer(req),
      },
    ],
  };
}
