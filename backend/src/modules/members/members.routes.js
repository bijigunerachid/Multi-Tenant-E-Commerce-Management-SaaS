import { z } from 'zod';
import { rateLimit } from '../../middleware/rateLimit.js';
import {
  emailSchema,
  nameSchema,
  passwordSchema,
  tokenSchema,
  uuidSchema,
} from '../../utils/schemas.js';
import { ROLES } from '../auth/permissions.js';
import { createMemberService } from './members.service.js';

// OWNER is never assignable directly: it changes only through the ownership transfer workflow.
const assignableRole = z.enum(
  ROLES.filter((role) => role !== 'OWNER'),
  { error: 'Choose a role' },
);

export function memberRoutes(deps) {
  const members = createMemberService(deps);
  const inviteLimit = rateLimit({
    redis: deps.redis,
    name: 'invite-org',
    windowSeconds: 3600,
    max: 30,
    key: (req) => req.ctx?.organizationId,
  });
  const memberParams = z.object({ membershipId: uuidSchema });

  return {
    basePath: '/members',
    routes: [
      {
        method: 'get',
        path: '/',
        access: { permission: 'member:read' },
        handler: (req) => members.list(req),
      },
      {
        method: 'patch',
        path: '/:membershipId',
        access: { permission: 'member:manage' },
        validate: { params: memberParams, body: z.object({ role: assignableRole }) },
        handler: (req) => members.changeRole(req, req.valid.params.membershipId, req.valid.body),
      },
      {
        method: 'post',
        path: '/:membershipId/deactivate',
        access: { permission: 'member:manage' },
        whenInactive: 'allow',
        validate: { params: memberParams },
        handler: (req) => members.setStatus(req, req.valid.params.membershipId, 'DEACTIVATED'),
      },
      {
        method: 'post',
        path: '/:membershipId/reactivate',
        access: { permission: 'member:manage' },
        validate: { params: memberParams },
        handler: (req) => members.setStatus(req, req.valid.params.membershipId, 'ACTIVE'),
      },
      {
        method: 'get',
        path: '/invitations',
        access: { permission: 'member:read' },
        handler: (req) => members.listInvitations(req),
      },
      {
        method: 'post',
        path: '/invitations',
        access: { permission: 'member:manage' },
        // Limited per organization, so it runs after authorization (it needs req.ctx).
        afterAuth: [inviteLimit],
        validate: { body: z.object({ email: emailSchema, role: assignableRole }) },
        status: 201,
        handler: (req) => members.invite(req, req.valid.body),
      },
      {
        method: 'delete',
        path: '/invitations/:invitationId',
        access: { permission: 'member:manage' },
        whenInactive: 'allow',
        validate: { params: z.object({ invitationId: uuidSchema }) },
        handler: (req) => members.revokeInvitation(req, req.valid.params.invitationId),
      },
    ],
  };
}

/** Public endpoints used by the person who received an invitation email. */
export function invitationRoutes(deps) {
  const members = createMemberService(deps);
  const tokenLimit = rateLimit({
    redis: deps.redis,
    name: 'invitation-token-ip',
    windowSeconds: 900,
    max: 30,
    key: (req) => req.ip,
  });

  return {
    basePath: '/invitations',
    routes: [
      {
        // POST rather than GET so the token is not written to access logs as part of a URL.
        method: 'post',
        path: '/preview',
        access: 'public',
        rateLimit: [tokenLimit],
        validate: { body: z.object({ token: tokenSchema }) },
        handler: (req) => members.previewInvitation(req, req.valid.body.token),
      },
      {
        method: 'post',
        path: '/accept',
        access: 'public',
        rateLimit: [tokenLimit],
        validate: {
          body: z.object({
            token: tokenSchema,
            name: nameSchema.optional(),
            password: passwordSchema.optional(),
          }),
        },
        handler: (req) => members.acceptInvitation(req, req.valid.body),
      },
    ],
  };
}
