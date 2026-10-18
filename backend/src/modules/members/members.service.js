import { AppError, conflict, forbidden, notFound, isUniqueViolation } from '../../utils/errors.js';
import { randomToken, sha256 } from '../../utils/crypto.js';
import { hashPassword } from '../../utils/passwords.js';
import { recordAudit } from '../../utils/audit.js';
import { invitationMessage } from '../../services/emails.js';
import { ROLE_LABELS } from '../auth/permissions.js';
import { describeSession } from '../auth/auth.service.js';
import { assertWithinLimit } from '../billing/limits.js';
import { subscriptionContext, subscriptionInactive } from '../billing/subscription.js';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function presentMember(m) {
  return {
    id: m.id,
    userId: m.userId,
    name: m.user.name,
    email: m.user.email,
    role: m.role,
    status: m.status,
    joinedAt: m.createdAt,
  };
}

function presentInvitation(inv) {
  return {
    id: inv.id,
    email: inv.email,
    role: inv.role,
    expiresAt: inv.expiresAt,
    expired: inv.expiresAt < new Date(),
    invitedBy: inv.invitedBy ? { name: inv.invitedBy.name } : null,
    createdAt: inv.createdAt,
  };
}

const invalidInvitation = () =>
  new AppError(410, 'INVITATION_INVALID', 'This invitation is invalid, expired or already used');

export function createMemberService({ prisma, emails, env }) {
  /**
   * Loads a member of the current organization for an administrative change and applies the
   * rules every such change shares: the member exists in this organization (404 otherwise,
   * including members of other organizations), it is not the caller, and it is not an owner.
   * Owners change only through the ownership transfer workflow, which is what keeps every
   * organization with exactly one active owner.
   */
  async function loadManageableMember(db, req, membershipId) {
    const member = await db.organizationMembership.findUnique({
      where: { id: membershipId },
      include: { user: true },
    });
    if (!member) throw notFound('Member not found');
    if (member.id === req.ctx.membershipId) {
      throw forbidden('CANNOT_CHANGE_SELF', 'You cannot change your own membership');
    }
    if (member.role === 'OWNER') {
      throw conflict(
        'USE_OWNERSHIP_TRANSFER',
        'Owners can only be changed through an ownership transfer',
      );
    }
    return member;
  }

  return {
    async list(req) {
      const members = await req.db.organizationMembership.findMany({
        include: { user: true },
        orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
      });
      return members.map(presentMember);
    },

    async changeRole(req, membershipId, { role }) {
      return req.db.$transaction(async (tx) => {
        const member = await loadManageableMember(tx, req, membershipId);
        if (member.role === role) return presentMember(member);
        const updated = await tx.organizationMembership.update({
          where: { id: member.id },
          data: { role },
          include: { user: true },
        });
        await recordAudit(tx, req, {
          action: 'member.role_changed',
          entityType: 'OrganizationMembership',
          entityId: member.id,
          metadata: { from: member.role, to: role },
        });
        return presentMember(updated);
      });
    },

    async setStatus(req, membershipId, status) {
      return req.db.$transaction(async (tx) => {
        const member = await loadManageableMember(tx, req, membershipId);
        if (member.status === status) return presentMember(member);
        if (status === 'ACTIVE') await assertWithinLimit(tx, req.ctx, 'members');
        const updated = await tx.organizationMembership.update({
          where: { id: member.id },
          data: { status },
          include: { user: true },
        });
        await recordAudit(tx, req, {
          action: status === 'ACTIVE' ? 'member.reactivated' : 'member.deactivated',
          entityType: 'OrganizationMembership',
          entityId: member.id,
        });
        // A deactivated member's next request fails in requireTenant; nothing else to revoke.
        return presentMember(updated);
      });
    },

    async listInvitations(req) {
      const invitations = await req.db.invitation.findMany({
        where: { acceptedAt: null, revokedAt: null },
        include: { invitedBy: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
      });
      return invitations.map(presentInvitation);
    },

    async invite(req, { email, role }) {
      const existingMember = await req.db.organizationMembership.findFirst({
        where: { user: { email } },
      });
      if (existingMember) {
        throw conflict(
          existingMember.status === 'ACTIVE' ? 'ALREADY_MEMBER' : 'MEMBER_DEACTIVATED',
          existingMember.status === 'ACTIVE'
            ? 'This person is already a member'
            : 'This person is a deactivated member. Reactivate them instead.',
          { fieldErrors: { email: 'Already a member of this organization' } },
        );
      }

      const token = randomToken();
      let invitation;
      try {
        invitation = await req.db.$transaction(async (tx) => {
          // An expired invitation should not block a new one.
          await tx.invitation.updateMany({
            where: { pendingEmail: email, expiresAt: { lt: new Date() } },
            data: { pendingEmail: null, revokedAt: new Date() },
          });
          await assertWithinLimit(tx, req.ctx, 'members');
          const created = await tx.invitation.create({
            data: {
              email,
              pendingEmail: email,
              role,
              tokenHash: sha256(token),
              expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
              invitedById: req.user.id,
            },
            include: { invitedBy: { select: { name: true } } },
          });
          await recordAudit(tx, req, {
            action: 'invitation.created',
            entityType: 'Invitation',
            entityId: created.id,
            metadata: { email, role },
          });
          return created;
        });
      } catch (err) {
        if (isUniqueViolation(err, 'pending_email') || isUniqueViolation(err, 'pendingEmail')) {
          throw conflict('INVITATION_PENDING', 'An invitation for this email is already pending', {
            fieldErrors: { email: 'An invitation is already pending for this email' },
          });
        }
        throw err;
      }

      const org = await req.db.organization.findFirstOrThrow();
      await emails.enqueue({
        kind: 'member.invitation',
        to: email,
        organizationId: req.ctx.organizationId,
        message: invitationMessage({
          appUrl: env.APP_URL,
          organizationName: org.name,
          inviterName: req.user.name,
          role: ROLE_LABELS[role],
          token,
        }),
      });
      return presentInvitation(invitation);
    },

    async revokeInvitation(req, invitationId) {
      const { count } = await req.db.invitation.updateMany({
        where: { id: invitationId, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date(), pendingEmail: null },
      });
      if (count === 0) throw notFound('Invitation not found');
      await recordAudit(req.db, req, {
        action: 'invitation.revoked',
        entityType: 'Invitation',
        entityId: invitationId,
      });
    },

    /** Public: shows the invitee what they are accepting. Requires the emailed token. */
    async previewInvitation(req, token) {
      const invitation = await prisma.invitation.findUnique({
        where: { tokenHash: sha256(token) },
        include: { organization: true },
      });
      if (
        !invitation ||
        invitation.pendingEmail === null ||
        invitation.expiresAt < new Date() ||
        invitation.organization.status !== 'ACTIVE'
      ) {
        throw invalidInvitation();
      }
      const account = await prisma.user.findUnique({
        where: { email: invitation.email },
        select: { id: true },
      });
      return {
        organizationName: invitation.organization.name,
        email: invitation.email,
        role: invitation.role,
        expiresAt: invitation.expiresAt,
        accountExists: Boolean(account),
        signedInAsInvitee: Boolean(account && req.session?.userId === account.id),
      };
    },

    /**
     * Accepts an invitation.
     * - Signed in as the invited email: joins the organization.
     * - Not signed in and no account for that email: creates the account (the emailed token
     *   proves control of the address, so it is marked verified), joins, and signs in.
     * - Not signed in but the account exists: must sign in first (409).
     * - Signed in as someone else: refused (403).
     */
    async acceptInvitation(req, { token, name, password }) {
      const invitation = await prisma.invitation.findUnique({
        where: { tokenHash: sha256(token) },
        include: {
          organization: { include: { subscription: { include: { plan: true } } } },
        },
      });
      if (
        !invitation ||
        invitation.pendingEmail === null ||
        invitation.expiresAt < new Date() ||
        invitation.organization.status !== 'ACTIVE'
      ) {
        throw invalidInvitation();
      }
      // The invitation already holds a seat; joining is refused only if the subscription ended.
      const subscription = subscriptionContext(invitation.organization.subscription);
      if (!subscription.usable) throw subscriptionInactive(subscription.status);

      let sessionUser = null;
      if (req.session) {
        sessionUser = await prisma.user.findUnique({ where: { id: req.session.userId } });
        if (sessionUser && sessionUser.email !== invitation.email) {
          throw forbidden(
            'INVITATION_EMAIL_MISMATCH',
            `This invitation was sent to ${invitation.email}. Sign in with that account to accept it.`,
          );
        }
      }

      const existingAccount =
        sessionUser ?? (await prisma.user.findUnique({ where: { email: invitation.email } }));
      if (existingAccount && !sessionUser) {
        throw conflict(
          'LOGIN_REQUIRED',
          'You already have an account. Sign in to accept the invitation.',
        );
      }
      if (!existingAccount && (!name || !password)) {
        throw new AppError(400, 'VALIDATION_FAILED', 'Some fields are invalid', {
          fieldErrors: {
            ...(name ? {} : { name: 'Enter your name' }),
            ...(password ? {} : { password: 'Choose a password' }),
          },
        });
      }
      const passwordHash = existingAccount ? null : await hashPassword(password);

      const { user, membership } = await prisma.$transaction(async (tx) => {
        // Claim the invitation atomically: a second concurrent accept finds nothing to claim.
        const claimed = await tx.invitation.updateMany({
          where: { id: invitation.id, pendingEmail: { not: null }, expiresAt: { gt: new Date() } },
          data: { acceptedAt: new Date(), pendingEmail: null },
        });
        if (claimed.count !== 1) throw invalidInvitation();

        const user =
          existingAccount ??
          (await tx.user.create({
            data: { email: invitation.email, name, passwordHash, emailVerifiedAt: new Date() },
          }));

        let membership;
        try {
          membership = await tx.organizationMembership.create({
            data: {
              organizationId: invitation.organizationId,
              userId: user.id,
              role: invitation.role,
              invitedById: invitation.invitedById,
            },
          });
        } catch (err) {
          if (isUniqueViolation(err))
            throw conflict('ALREADY_MEMBER', 'You are already a member of this organization');
          throw err;
        }
        await tx.user.update({
          where: { id: user.id },
          data: { lastActiveOrganizationId: invitation.organizationId },
        });
        await recordAudit(tx, req, {
          organizationId: invitation.organizationId,
          actorUserId: user.id,
          action: 'invitation.accepted',
          entityType: 'OrganizationMembership',
          entityId: membership.id,
          metadata: {
            invitationId: invitation.id,
            role: invitation.role,
            newAccount: !existingAccount,
          },
        });
        return { user, membership };
      });

      req.user = user;
      if (sessionUser) {
        await req.updateSession({ activeOrganizationId: membership.organizationId });
      } else {
        await req.startSession({
          userId: user.id,
          activeOrganizationId: membership.organizationId,
        });
      }
      return describeSession(prisma, req);
    },
  };
}
