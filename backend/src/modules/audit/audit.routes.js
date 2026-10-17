import { paginationSchema } from '../../utils/schemas.js';

export function auditRoutes({ prisma }) {
  return {
    basePath: '/audit-logs',
    routes: [
      {
        method: 'get',
        path: '/',
        access: { permission: 'audit:read' },
        validate: { query: paginationSchema },
        handler: async (req, res) => {
          const { page, pageSize } = req.valid.query;
          const [rows, total] = await Promise.all([
            req.db.auditLog.findMany({
              orderBy: { createdAt: 'desc' },
              skip: (page - 1) * pageSize,
              take: pageSize,
            }),
            req.db.auditLog.count(),
          ]);
          const actorIds = [...new Set(rows.map((r) => r.actorUserId).filter(Boolean))];
          const actors = await prisma.user.findMany({
            where: { id: { in: actorIds } },
            select: { id: true, name: true },
          });
          const names = new Map(actors.map((a) => [a.id, a.name]));
          res.json({
            data: rows.map((r) => ({
              id: r.id,
              action: r.action,
              entityType: r.entityType,
              entityId: r.entityId,
              metadata: r.metadata,
              actor: r.actorUserId
                ? { id: r.actorUserId, name: names.get(r.actorUserId) ?? null }
                : null,
              ip: r.ip,
              createdAt: r.createdAt,
            })),
            meta: { page, pageSize, total },
          });
        },
      },
    ],
  };
}
