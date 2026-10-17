-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "email" VARCHAR(254),
    "phone" VARCHAR(40),
    "notes" VARCHAR(2000),
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addresses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "default_for_customer_id" UUID,
    "label" VARCHAR(60),
    "recipient_name" VARCHAR(160),
    "line1" VARCHAR(200) NOT NULL,
    "line2" VARCHAR(200),
    "city" VARCHAR(120) NOT NULL,
    "region" VARCHAR(120),
    "postal_code" VARCHAR(20),
    "country" CHAR(2) NOT NULL,
    "phone" VARCHAR(40),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "addresses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customers_organization_id_created_at_idx" ON "customers"("organization_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "customers_organization_id_name_idx" ON "customers"("organization_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "customers_organization_id_email_key" ON "customers"("organization_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "customers_organization_id_id_key" ON "customers"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "addresses_default_for_customer_id_key" ON "addresses"("default_for_customer_id");

-- CreateIndex
CREATE INDEX "addresses_organization_id_customer_id_idx" ON "addresses"("organization_id", "customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "addresses_organization_id_id_key" ON "addresses"("organization_id", "id");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_organization_id_customer_id_fkey" FOREIGN KEY ("organization_id", "customer_id") REFERENCES "customers"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Invariants Prisma cannot express (see docs/data-model.md).
ALTER TABLE "customers"
    ADD CONSTRAINT "customers_email_lowercase_check" CHECK ("email" IS NULL OR "email" = lower("email")),
    ADD CONSTRAINT "customers_name_not_blank_check" CHECK (length(trim("name")) > 0);

ALTER TABLE "addresses"
    ADD CONSTRAINT "addresses_default_check" CHECK ("default_for_customer_id" IS NULL OR "default_for_customer_id" = "customer_id"),
    ADD CONSTRAINT "addresses_country_check" CHECK ("country" ~ '^[A-Z]{2}$');
