import { z } from 'zod';
import { paginationSchema, uuidSchema } from '../../utils/schemas.js';
import { notFound, AppError } from '../../utils/errors.js';
import { NOTIFICATION_TYPE_NAMES, visibleTypes } from './types.js';

// The signed-in member's own notifications in the active organization. Every member can open
// the notification center (org:read); what it holds depends on their role: only the types
// their current role receives are listed, counted or marked read, so a member who loses a
// permission also stops seeing what it used to bring them.

const listQuery = paginationSchema.extend({
  unread: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});
const idParams = z.object({ notificationId: uuidSchema });
const preferencesBody = z.object({
  email: z
    .object(Object.fromEntries(NOTIFICATION_TYPE_NAMES.map((t) => [t, z.boolean().optional()])))
    .strict(),
});

const present = (n) => ({
  id: n.id,
  type: n.type,
  data: n.data,
  readAt: n.readAt,
  createdAt: n.createdAt,
});

const mine = (req) => ({
  membershipId: req.ctx.membershipId,
  type: { in: visibleTypes(req.ctx.permissions) },
});

export function notificationRoutes() {
  return {
    basePath: '/notifications',
    routes: [
      {
        method: 'get',
        path: '/',
        access: { permission: 'org:read' },
        validate: { query: listQuery },
        handler: async (req, res) => {
          const { page, pageSize, unread } = req.valid.query;
          const where = { ...mine(req), ...(unread ? { readAt: null } : {}) };
          const [rows, total, unreadCount] = await Promise.all([
            req.db.notification.findMany({
              where,
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
              skip: (page - 1) * pageSize,
              take: pageSize,
            }),
            req.db.notification.count({ where }),
            req.db.notification.count({ where: { ...mine(req), readAt: null } }),
          ]);
          res.json({ data: rows.map(present), meta: { page, pageSize, total, unreadCount } });
        },
      },
      {
        method: 'get',
        path: '/unread-count',
        access: { permission: 'org:read' },
        handler: async (req) => ({
          count: await req.db.notification.count({ where: { ...mine(req), readAt: null } }),
        }),
      },
      {
        method: 'post',
        path: '/read-all',
        access: { permission: 'org:read' },
        whenInactive: 'allow',
        handler: async (req) => {
          const { count } = await req.db.notification.updateMany({
            where: { ...mine(req), readAt: null },
            data: { readAt: new Date() },
          });
          return { updated: count };
        },
      },
      {
        method: 'post',
        path: '/:notificationId/read',
        access: { permission: 'org:read' },
        whenInactive: 'allow',
        validate: { params: idParams },
        handler: async (req) => {
          const where = { ...mine(req), id: req.valid.params.notificationId };
          const found = await req.db.notification.findFirst({ where });
          if (!found) throw notFound('Notification not found');
          if (found.readAt) return present(found);
          // Keeps the first read time if two tabs mark it at once.
          await req.db.notification.updateMany({
            where: { ...where, readAt: null },
            data: { readAt: new Date() },
          });
          return present(await req.db.notification.findFirst({ where }));
        },
      },
      {
        method: 'get',
        path: '/preferences',
        access: { permission: 'org:read' },
        handler: async (req) => {
          const membership = await req.db.organizationMembership.findUnique({
            where: { id: req.ctx.membershipId },
            select: { emailNotifications: true },
          });
          return visibleTypes(req.ctx.permissions).map((type) => ({
            type,
            email: membership.emailNotifications.includes(type),
          }));
        },
      },
      {
        method: 'put',
        path: '/preferences',
        access: { permission: 'org:read' },
        whenInactive: 'allow',
        validate: { body: preferencesBody },
        handler: async (req) => {
          const visible = visibleTypes(req.ctx.permissions);
          const changes = Object.entries(req.valid.body.email).filter(([, v]) => v !== undefined);
          const notMine = changes.filter(([type]) => !visible.includes(type));
          if (notMine.length) {
            throw new AppError(400, 'VALIDATION_FAILED', 'Some fields are invalid', {
              fieldErrors: Object.fromEntries(
                notMine.map(([type]) => [`email.${type}`, 'Your role does not receive these']),
              ),
            });
          }
          const membership = await req.db.organizationMembership.findUnique({
            where: { id: req.ctx.membershipId },
            select: { emailNotifications: true },
          });
          const wanted = new Set(membership.emailNotifications);
          for (const [type, on] of changes) {
            if (on) wanted.add(type);
            else wanted.delete(type);
          }
          const updated = await req.db.organizationMembership.update({
            where: { id: req.ctx.membershipId },
            data: { emailNotifications: NOTIFICATION_TYPE_NAMES.filter((t) => wanted.has(t)) },
            select: { emailNotifications: true },
          });
          return visible.map((type) => ({
            type,
            email: updated.emailNotifications.includes(type),
          }));
        },
      },
    ],
  };
}
