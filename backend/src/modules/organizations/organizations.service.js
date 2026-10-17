import { randomBytes } from 'node:crypto';
import { AppError, conflict, forbidden, notFound, isUniqueViolation } from '../../utils/errors.js';
import { verifyPassword } from '../../utils/passwords.js';
import { recordAudit } from '../../utils/audit.js';
import { slugify } from '../../utils/schemas.js';
import { ownershipTransferMessage } from '../../services/emails.js';
import { describeSession } from '../auth/auth.service.js';

const TRANSFER_TTL_MS = 72 * 60 * 60 * 1000;

export function publicOrganization(org) {
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    status: org.status,
    defaultCurrency: org.defaultCurrency,
    timezone: org.timezone,
    contactEmail: org.contactEmail,
    contactPhone: org.contactPhone,
    createdAt: org.createdAt,
  };
}

function presentTransfer(transfer) {
  if (!transfer) return null;
  const member = (m) => ({ membershipId: m.id, name: m.user.name, email: m.user.email });
  return {
    from: member(transfer.fromMembership),
    to: member(transfer.toMembership),
    expiresAt: transfer.expiresAt,
    createdAt: transfer.createdAt,
  };
}

export function createOrganizationService({ prisma, mailer, env }) {
  /** Loads the pending transfer, deleting it first if it has expired. */
  async function loadTransfer(db) {
    const transfer = await db.ownershipTransfer.findFirst({
      include: {
        fromMembership: { include: { user: true } },
        toMembership: { include: { user: true } },
      },
    });
    if (transfer && transfer.expiresAt < new Date()) {
      await db.ownershipTransfer.deleteMany({});
      return null;
    }
    return transfer;
  }

  return {
    /**
     * Onboarding: creates the organization, makes the caller its owner, creates the first
     * store, and switches the caller's session into it. All or nothing.
     */
    async create(req, input) {
      if (!req.user.emailVerifiedAt) {
        throw forbidden(
          'EMAIL_NOT_VERIFIED',
          'Confirm your email address before creating an organization',
        );
      }

      const requestedSlug = input.slug;
      let slug = requestedSlug ?? (slugify(input.name) || 'org');

      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          const org = await prisma.$transaction(async (tx) => {
            const organization = await tx.organization.create({
              data: {
                name: input.name,
                slug,
                defaultCurrency: input.defaultCurrency,
                timezone: input.timezone,
              },
            });
            await tx.organizationMembership.create({
              data: { organizationId: organization.id, userId: req.user.id, role: 'OWNER' },
            });
            const store = await tx.store.create({
              data: {
                organizationId: organization.id,
                name: input.storeName,
                slug: slugify(input.storeName) || 'main',
                currency: input.defaultCurrency,
                timezone: input.timezone,
              },
            });
            await tx.user.update({
              where: { id: req.user.id },
              data: { lastActiveOrganizationId: organization.id },
            });
            await recordAudit(tx, req, {
              organizationId: organization.id,
              action: 'organization.created',
              entityType: 'Organization',
              entityId: organization.id,
              metadata: { name: organization.name, slug, firstStoreId: store.id },
            });
            return organization;
          });

          await req.updateSession({ activeOrganizationId: org.id });
          return {
            organization: publicOrganization(org),
            session: await describeSession(prisma, req),
          };
        } catch (err) {
          if (!isUniqueViolation(err, 'slug')) throw err;
          if (requestedSlug) {
            throw conflict('SLUG_TAKEN', 'This address is already taken', {
              fieldErrors: { slug: 'This address is already taken' },
            });
          }
          // Generated slug collided: add a short random suffix and try again.
          slug = `${slugify(input.name).slice(0, 50) || 'org'}-${randomBytes(3).toString('hex')}`;
        }
      }
      throw new AppError(503, 'SLUG_UNAVAILABLE', 'Could not create the organization. Try again.');
    },

    /**
     * Switches the session's active organization after checking, on the server, that the
     * caller is an active member of an active organization. Anything else is a 404 so the
     * response does not reveal whether a foreign organization exists.
     */
    async switchTo(req, organizationId) {
      const membership = await prisma.organizationMembership.findUnique({
        where: { userId_organizationId: { userId: req.user.id, organizationId } },
        include: { organization: { select: { status: true } } },
      });
      if (
        !membership ||
        membership.status !== 'ACTIVE' ||
        membership.organization.status !== 'ACTIVE'
      ) {
        throw notFound('Organization not found');
      }
      await prisma.user.update({
        where: { id: req.user.id },
        data: { lastActiveOrganizationId: organizationId },
      });
      await req.updateSession({ activeOrganizationId: organizationId });
      return describeSession(prisma, req);
    },

    async getCurrent(req) {
      const org = await req.db.organization.findFirstOrThrow();
      return publicOrganization(org);
    },

    async updateCurrent(req, changes) {
      const before = await req.db.organization.findFirstOrThrow();
      const org = await req.db.$transaction(async (tx) => {
        const updated = await tx.organization.update({
          where: { id: req.ctx.organizationId },
          data: changes,
        });
        const changed = Object.keys(changes).filter((k) => before[k] !== updated[k]);
        if (changed.length) {
          await recordAudit(tx, req, {
            action: 'organization.updated',
            entityType: 'Organization',
            entityId: updated.id,
            metadata: { changed },
          });
        }
        return updated;
      });
      return publicOrganization(org);
    },

    async getTransfer(req) {
      return presentTransfer(await loadTransfer(req.db));
    },

    async startTransfer(req, { toMembershipId, password }) {
      if (!(await verifyPassword(req.user.passwordHash, password))) {
        throw new AppError(400, 'VALIDATION_FAILED', 'Some fields are invalid', {
          fieldErrors: { password: 'Your password is incorrect' },
        });
      }
      if (toMembershipId === req.ctx.membershipId) {
        throw conflict('TRANSFER_TO_SELF', 'Choose another member');
      }
      const target = await req.db.organizationMembership.findUnique({
        where: { id: toMembershipId },
        include: { user: true },
      });
      if (!target) throw notFound('Member not found');
      if (target.status !== 'ACTIVE')
        throw conflict('MEMBER_INACTIVE', 'This member is deactivated');
      if (target.role === 'OWNER')
        throw conflict('ALREADY_OWNER', 'This member is already an owner');

      if (await loadTransfer(req.db)) {
        throw conflict(
          'TRANSFER_PENDING',
          'An ownership transfer is already pending. Cancel it first.',
        );
      }

      const transfer = await req.db.$transaction(async (tx) => {
        const created = await tx.ownershipTransfer.create({
          data: {
            organizationId: req.ctx.organizationId,
            fromMembershipId: req.ctx.membershipId,
            toMembershipId,
            expiresAt: new Date(Date.now() + TRANSFER_TTL_MS),
          },
        });
        await recordAudit(tx, req, {
          action: 'organization.ownership_transfer_started',
          entityType: 'OrganizationMembership',
          entityId: toMembershipId,
        });
        return created;
      });

      const org = await req.db.organization.findFirstOrThrow();
      await mailer.send({
        to: target.user.email,
        ...ownershipTransferMessage({
          appUrl: env.APP_URL,
          organizationName: org.name,
          fromName: req.user.name,
        }),
      });
      return presentTransfer({
        ...transfer,
        fromMembership: { id: req.ctx.membershipId, user: req.user },
        toMembership: target,
      });
    },

    async cancelTransfer(req) {
      const { count } = await req.db.ownershipTransfer.deleteMany({});
      if (count === 0) throw notFound('No ownership transfer is pending');
      await recordAudit(req.db, req, {
        action: 'organization.ownership_transfer_cancelled',
        entityType: 'Organization',
        entityId: req.ctx.organizationId,
      });
    },

    /**
     * The invited member accepts. In one transaction, with the owner rows locked: the target
     * becomes OWNER and the previous owner becomes MANAGER. The organization is never left
     * without an active owner.
     */
    async acceptTransfer(req) {
      await req.db.$transaction(async (tx) => {
        await tx.$queryRaw`
          SELECT id FROM organization_memberships
          WHERE organization_id = ${req.ctx.organizationId}::uuid
          FOR UPDATE`;
        const transfer = await tx.ownershipTransfer.findUnique({
          where: { organizationId: req.ctx.organizationId },
          include: { fromMembership: true },
        });
        if (!transfer || transfer.toMembershipId !== req.ctx.membershipId) {
          throw notFound('No ownership transfer is pending for you');
        }
        if (transfer.expiresAt < new Date()) {
          await tx.ownershipTransfer.delete({ where: { organizationId: req.ctx.organizationId } });
          throw conflict('TRANSFER_EXPIRED', 'This ownership transfer has expired');
        }
        const from = transfer.fromMembership;
        if (from.status !== 'ACTIVE' || from.role !== 'OWNER') {
          await tx.ownershipTransfer.delete({ where: { organizationId: req.ctx.organizationId } });
          throw conflict(
            'TRANSFER_STALE',
            'The member who started this transfer is no longer an owner',
          );
        }

        await tx.organizationMembership.update({
          where: { id: req.ctx.membershipId },
          data: { role: 'OWNER' },
        });
        await tx.organizationMembership.update({
          where: { id: from.id },
          data: { role: 'MANAGER' },
        });
        await tx.ownershipTransfer.delete({ where: { organizationId: req.ctx.organizationId } });

        const owners = await tx.organizationMembership.count({
          where: { organizationId: req.ctx.organizationId, role: 'OWNER', status: 'ACTIVE' },
        });
        if (owners < 1) throw new Error('Invariant violated: organization would have no owner');

        await recordAudit(tx, req, {
          action: 'organization.ownership_transferred',
          entityType: 'OrganizationMembership',
          entityId: req.ctx.membershipId,
          metadata: { fromMembershipId: from.id },
        });
      });
      return describeSession(prisma, req);
    },
  };
}
