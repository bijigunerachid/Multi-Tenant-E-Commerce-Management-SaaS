-- CreateEnum
CREATE TYPE "member_role" AS ENUM ('OWNER', 'MANAGER', 'INVENTORY_MANAGER', 'ORDER_MANAGER', 'ANALYST');

-- CreateEnum
CREATE TYPE "membership_status" AS ENUM ('ACTIVE', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "auth_token_purpose" AS ENUM ('EMAIL_VERIFY', 'PASSWORD_RESET');

-- CreateEnum
CREATE TYPE "store_status" AS ENUM ('ACTIVE', 'ARCHIVED');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "last_active_organization_id" UUID;

-- CreateTable
CREATE TABLE "auth_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "purpose" "auth_token_purpose" NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_memberships" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "member_role" NOT NULL,
    "status" "membership_status" NOT NULL DEFAULT 'ACTIVE',
    "invited_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "organization_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "pending_email" VARCHAR(254),
    "role" "member_role" NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "accepted_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "invited_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ownership_transfers" (
    "organization_id" UUID NOT NULL,
    "from_membership_id" UUID NOT NULL,
    "to_membership_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ownership_transfers_pkey" PRIMARY KEY ("organization_id")
);

-- CreateTable
CREATE TABLE "stores" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(60) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "timezone" VARCHAR(64) NOT NULL,
    "status" "store_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID,
    "actor_user_id" UUID,
    "action" VARCHAR(80) NOT NULL,
    "entity_type" VARCHAR(60),
    "entity_id" VARCHAR(64),
    "metadata" JSONB,
    "ip" VARCHAR(64),
    "user_agent" VARCHAR(300),
    "request_id" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "auth_tokens_token_hash_key" ON "auth_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "auth_tokens_user_id_purpose_idx" ON "auth_tokens"("user_id", "purpose");

-- CreateIndex
CREATE INDEX "organization_memberships_organization_id_role_status_idx" ON "organization_memberships"("organization_id", "role", "status");

-- CreateIndex
CREATE UNIQUE INDEX "organization_memberships_user_id_organization_id_key" ON "organization_memberships"("user_id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "organization_memberships_organization_id_id_key" ON "organization_memberships"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations"("token_hash");

-- CreateIndex
CREATE INDEX "invitations_organization_id_created_at_idx" ON "invitations"("organization_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "invitations_organization_id_pending_email_key" ON "invitations"("organization_id", "pending_email");

-- CreateIndex
CREATE UNIQUE INDEX "stores_organization_id_slug_key" ON "stores"("organization_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "stores_organization_id_id_key" ON "stores"("organization_id", "id");

-- CreateIndex
CREATE INDEX "audit_logs_organization_id_created_at_idx" ON "audit_logs"("organization_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_actor_user_id_created_at_idx" ON "audit_logs"("actor_user_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_last_active_organization_id_fkey" FOREIGN KEY ("last_active_organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ownership_transfers" ADD CONSTRAINT "ownership_transfers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ownership_transfers" ADD CONSTRAINT "ownership_transfers_organization_id_from_membership_id_fkey" FOREIGN KEY ("organization_id", "from_membership_id") REFERENCES "organization_memberships"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ownership_transfers" ADD CONSTRAINT "ownership_transfers_organization_id_to_membership_id_fkey" FOREIGN KEY ("organization_id", "to_membership_id") REFERENCES "organization_memberships"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stores" ADD CONSTRAINT "stores_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Invariants Prisma cannot express (see docs/data-model.md).

-- Invitation emails are lower-cased, and pending_email is either NULL or a copy of email.
-- A pending invitation (not accepted, not revoked) must have pending_email set, which is what
-- makes "one pending invitation per email and organization" enforceable by a unique index.
ALTER TABLE "invitations"
    ADD CONSTRAINT "invitations_email_lowercase_check" CHECK ("email" = lower("email")),
    ADD CONSTRAINT "invitations_pending_email_check" CHECK (
        ("accepted_at" IS NULL AND "revoked_at" IS NULL AND "pending_email" = "email")
        OR (("accepted_at" IS NOT NULL OR "revoked_at" IS NOT NULL) AND "pending_email" IS NULL)
    ),
    ADD CONSTRAINT "invitations_role_not_owner_check" CHECK ("role" <> 'OWNER');

ALTER TABLE "ownership_transfers"
    ADD CONSTRAINT "ownership_transfers_distinct_members_check" CHECK ("from_membership_id" <> "to_membership_id");

ALTER TABLE "stores"
    ADD CONSTRAINT "stores_slug_format_check" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    ADD CONSTRAINT "stores_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$');

-- The audit log is append-only. TRUNCATE (used only by the test suite) is not row-level and
-- is not affected; the application never issues it.
CREATE FUNCTION "audit_logs_block_changes"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'audit_logs is append-only (% blocked)', TG_OP;
END;
$$;

CREATE TRIGGER "audit_logs_append_only"
    BEFORE UPDATE OR DELETE ON "audit_logs"
    FOR EACH ROW EXECUTE FUNCTION "audit_logs_block_changes"();
