import { z } from 'zod';
import { paginationSchema } from '../../utils/schemas.js';

// The organization's email delivery history: invitations and ownership transfers, with their
// status, attempts and last error. Owners only (audit:read). Account emails (verification,
// password reset) belong to no organization and never appear here. Message bodies are not
// stored, so nothing here can reveal a one-time link.

const query = paginationSchema.extend({
  status: z.enum(['QUEUED', 'SENT', 'FAILED']).optional(),
});

export function emailRoutes() {
  return {
    basePath: '/email-deliveries',
    routes: [
      {
        method: 'get',
        path: '/',
        access: { permission: 'audit:read' },
        validate: { query },
        handler: async (req, res) => {
          const { page, pageSize, status } = req.valid.query;
          const where = status ? { status } : {};
          const [rows, total] = await Promise.all([
            req.db.emailDelivery.findMany({
              where,
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
              skip: (page - 1) * pageSize,
              take: pageSize,
            }),
            req.db.emailDelivery.count({ where }),
          ]);
          res.json({
            data: rows.map((r) => ({
              id: r.id,
              kind: r.kind,
              to: r.toAddress,
              subject: r.subject,
              status: r.status,
              attempts: r.attempts,
              lastError: r.lastError,
              createdAt: r.createdAt,
              sentAt: r.sentAt,
              failedAt: r.failedAt,
            })),
            meta: { page, pageSize, total },
          });
        },
      },
    ],
  };
}
