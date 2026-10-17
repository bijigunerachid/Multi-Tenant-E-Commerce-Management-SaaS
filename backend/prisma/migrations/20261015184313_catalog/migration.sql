-- CreateEnum
CREATE TYPE "product_status" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "parent_id" UUID,
    "name" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(60) NOT NULL,
    "description" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "category_id" UUID,
    "name" VARCHAR(200) NOT NULL,
    "description" VARCHAR(5000),
    "status" "product_status" NOT NULL DEFAULT 'DRAFT',
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "sku" VARCHAR(64) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "options" JSONB NOT NULL DEFAULT '{}',
    "price" DECIMAL(12,2) NOT NULL,
    "cost" DECIMAL(12,2),
    "currency" CHAR(3) NOT NULL,
    "low_stock_threshold" INTEGER NOT NULL DEFAULT 5,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_images" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "storage_key" VARCHAR(200) NOT NULL,
    "mime_type" VARCHAR(40) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "alt_text" VARCHAR(300),
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "categories_organization_id_parent_id_idx" ON "categories"("organization_id", "parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "categories_organization_id_slug_key" ON "categories"("organization_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "categories_organization_id_id_key" ON "categories"("organization_id", "id");

-- CreateIndex
CREATE INDEX "products_organization_id_status_created_at_idx" ON "products"("organization_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "products_organization_id_category_id_idx" ON "products"("organization_id", "category_id");

-- CreateIndex
CREATE UNIQUE INDEX "products_organization_id_id_key" ON "products"("organization_id", "id");

-- CreateIndex
CREATE INDEX "product_variants_organization_id_product_id_idx" ON "product_variants"("organization_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_organization_id_sku_key" ON "product_variants"("organization_id", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_organization_id_id_key" ON "product_variants"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "product_images_storage_key_key" ON "product_images"("storage_key");

-- CreateIndex
CREATE INDEX "product_images_organization_id_product_id_position_idx" ON "product_images"("organization_id", "product_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "product_images_organization_id_id_key" ON "product_images"("organization_id", "id");

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_organization_id_parent_id_fkey" FOREIGN KEY ("organization_id", "parent_id") REFERENCES "categories"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_organization_id_category_id_fkey" FOREIGN KEY ("organization_id", "category_id") REFERENCES "categories"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_organization_id_product_id_fkey" FOREIGN KEY ("organization_id", "product_id") REFERENCES "products"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_organization_id_product_id_fkey" FOREIGN KEY ("organization_id", "product_id") REFERENCES "products"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Invariants Prisma cannot express (see docs/data-model.md).
ALTER TABLE "categories"
    ADD CONSTRAINT "categories_slug_format_check" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    ADD CONSTRAINT "categories_not_own_parent_check" CHECK ("parent_id" IS NULL OR "parent_id" <> "id");

ALTER TABLE "products"
    ADD CONSTRAINT "products_archived_at_check" CHECK (("status" = 'ARCHIVED') = ("archived_at" IS NOT NULL));

-- SKUs are stored trimmed and upper-cased, so the unique index is case-insensitive in effect.
ALTER TABLE "product_variants"
    ADD CONSTRAINT "product_variants_sku_format_check" CHECK ("sku" = upper("sku") AND "sku" ~ '^[A-Z0-9][A-Z0-9._/-]*$'),
    ADD CONSTRAINT "product_variants_price_check" CHECK ("price" >= 0),
    ADD CONSTRAINT "product_variants_cost_check" CHECK ("cost" IS NULL OR "cost" >= 0),
    ADD CONSTRAINT "product_variants_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
    ADD CONSTRAINT "product_variants_low_stock_threshold_check" CHECK ("low_stock_threshold" >= 0),
    ADD CONSTRAINT "product_variants_options_object_check" CHECK (jsonb_typeof("options") = 'object');

ALTER TABLE "product_images"
    ADD CONSTRAINT "product_images_mime_type_check" CHECK ("mime_type" IN ('image/jpeg', 'image/png', 'image/webp')),
    ADD CONSTRAINT "product_images_size_check" CHECK ("size_bytes" > 0 AND "size_bytes" <= 5242880);
