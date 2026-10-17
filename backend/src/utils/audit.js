/**
 * Writes an audit log row. Pass the transaction client when the audited change happens in a
 * transaction, so the change and its audit record are committed (or rolled back) together.
 * Never put secrets (passwords, tokens) in `metadata`.
 */
export function recordAudit(
  db,
  req,
  { action, entityType, entityId, metadata, organizationId, actorUserId },
) {
  return db.auditLog.create({
    data: {
      organizationId: organizationId ?? req.ctx?.organizationId ?? null,
      actorUserId: actorUserId ?? req.user?.id ?? null,
      action,
      entityType: entityType ?? null,
      entityId: entityId ?? null,
      metadata: metadata ?? undefined,
      ip: req.ip ? String(req.ip).slice(0, 64) : null,
      userAgent: req.headers['user-agent']?.slice(0, 300) ?? null,
      requestId: req.id ? String(req.id) : null,
    },
  });
}
