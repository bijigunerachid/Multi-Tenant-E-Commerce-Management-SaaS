-- CreateEnum
CREATE TYPE "platform_role" AS ENUM ('NONE', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "organization_status" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" VARCHAR(254) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "email_verified_at" TIMESTAMPTZ(3),
    "platform_role" "platform_role" NOT NULL DEFAULT 'NONE',
    "status" "user_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(60) NOT NULL,
    "status" "organization_status" NOT NULL DEFAULT 'ACTIVE',
    "suspended_at" TIMESTAMPTZ(3),
    "suspended_reason" VARCHAR(500),
    "default_currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'UTC',
    "contact_email" VARCHAR(254),
    "contact_phone" VARCHAR(40),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- Invariants Prisma cannot express (see docs/data-model.md).
-- Emails are stored lower-cased, which makes "users_email_key" case-insensitive in effect.
ALTER TABLE "users"
    ADD CONSTRAINT "users_email_lowercase_check" CHECK ("email" = lower("email"));

-- Slugs appear in URLs: lower-case letters, digits and single hyphens.
ALTER TABLE "organizations"
    ADD CONSTRAINT "organizations_slug_format_check" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

-- ISO 4217 currency codes are three upper-case letters.
ALTER TABLE "organizations"
    ADD CONSTRAINT "organizations_default_currency_check" CHECK ("default_currency" ~ '^[A-Z]{3}$');

-- A suspended organization always records when it was suspended, and an active one never does.
ALTER TABLE "organizations"
    ADD CONSTRAINT "organizations_suspension_check" CHECK (("status" = 'SUSPENDED') = ("suspended_at" IS NOT NULL));
