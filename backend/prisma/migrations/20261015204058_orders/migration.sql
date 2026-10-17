-- CreateEnum
CREATE TYPE "order_status" AS ENUM ('DRAFT', 'PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "reservation_status" AS ENUM ('ACTIVE', 'RELEASED', 'CONSUMED');

-- CreateTable
CREATE TABLE "organization_counters" (
    "organization_id" UUID NOT NULL,
    "last_order_number" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "organization_counters_pkey" PRIMARY KEY ("organization_id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "customer_id" UUID,
    "number" INTEGER,
    "status" "order_status" NOT NULL DEFAULT 'DRAFT',
    "currency" CHAR(3) NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "discount_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "tax_rate" DECIMAL(6,4) NOT NULL DEFAULT 0,
    "tax_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "shipping_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "customer_name" VARCHAR(160),
    "customer_email" VARCHAR(254),
    "shipping_address" JSONB,
    "notes" VARCHAR(1000),
    "cancel_reason" VARCHAR(500),
    "created_by_id" UUID,
    "placed_at" TIMESTAMPTZ(3),
    "shipped_at" TIMESTAMPTZ(3),
    "delivered_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "product_name" VARCHAR(200) NOT NULL,
    "variant_name" VARCHAR(120) NOT NULL,
    "sku" VARCHAR(64) NOT NULL,
    "unit_price" DECIMAL(12,2) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "line_total" DECIMAL(12,2) NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_status_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "from_status" "order_status",
    "to_status" "order_status" NOT NULL,
    "note" VARCHAR(500),
    "actor_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_reservations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "inventory_level_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "reservation_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "inventory_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "orders_organization_id_status_created_at_idx" ON "orders"("organization_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "orders_organization_id_customer_id_idx" ON "orders"("organization_id", "customer_id");

-- CreateIndex
CREATE INDEX "orders_organization_id_placed_at_idx" ON "orders"("organization_id", "placed_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "orders_organization_id_number_key" ON "orders"("organization_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "orders_organization_id_id_key" ON "orders"("organization_id", "id");

-- CreateIndex
CREATE INDEX "order_items_organization_id_variant_id_idx" ON "order_items"("organization_id", "variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_items_organization_id_id_key" ON "order_items"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "order_items_order_id_variant_id_key" ON "order_items"("order_id", "variant_id");

-- CreateIndex
CREATE INDEX "order_status_history_organization_id_order_id_created_at_idx" ON "order_status_history"("organization_id", "order_id", "created_at");

-- CreateIndex
CREATE INDEX "inventory_reservations_organization_id_inventory_level_id_s_idx" ON "inventory_reservations"("organization_id", "inventory_level_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_reservations_organization_id_order_item_id_key" ON "inventory_reservations"("organization_id", "order_item_id");

-- CreateIndex
CREATE INDEX "inventory_movements_organization_id_order_id_idx" ON "inventory_movements"("organization_id", "order_id");

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_organization_id_order_id_fkey" FOREIGN KEY ("organization_id", "order_id") REFERENCES "orders"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_counters" ADD CONSTRAINT "organization_counters_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_organization_id_store_id_fkey" FOREIGN KEY ("organization_id", "store_id") REFERENCES "stores"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_organization_id_customer_id_fkey" FOREIGN KEY ("organization_id", "customer_id") REFERENCES "customers"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_organization_id_order_id_fkey" FOREIGN KEY ("organization_id", "order_id") REFERENCES "orders"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_organization_id_variant_id_fkey" FOREIGN KEY ("organization_id", "variant_id") REFERENCES "product_variants"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_organization_id_order_id_fkey" FOREIGN KEY ("organization_id", "order_id") REFERENCES "orders"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_organization_id_order_item_id_fkey" FOREIGN KEY ("organization_id", "order_item_id") REFERENCES "order_items"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_organization_id_inventory_level_id_fkey" FOREIGN KEY ("organization_id", "inventory_level_id") REFERENCES "inventory_levels"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Invariants Prisma cannot express (see docs/data-model.md).
ALTER TABLE "orders"
    ADD CONSTRAINT "orders_amounts_check" CHECK (
        "subtotal" >= 0 AND "discount_total" >= 0 AND "tax_total" >= 0 AND "shipping_total" >= 0
        AND "discount_total" <= "subtotal" AND "tax_rate" >= 0 AND "tax_rate" <= 1
    ),
    ADD CONSTRAINT "orders_total_check" CHECK ("total" = "subtotal" - "discount_total" + "tax_total" + "shipping_total"),
    ADD CONSTRAINT "orders_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
    -- Drafts have no number; every placed order has one.
    ADD CONSTRAINT "orders_number_check" CHECK (("status" = 'DRAFT') = ("number" IS NULL) AND ("number" IS NULL OR "number" > 0)),
    ADD CONSTRAINT "orders_placed_at_check" CHECK (("status" = 'DRAFT') = ("placed_at" IS NULL)),
    ADD CONSTRAINT "orders_cancelled_check" CHECK (("status" = 'CANCELLED') = ("cancelled_at" IS NOT NULL));

ALTER TABLE "order_items"
    ADD CONSTRAINT "order_items_quantity_check" CHECK ("quantity" > 0),
    ADD CONSTRAINT "order_items_price_check" CHECK ("unit_price" >= 0),
    ADD CONSTRAINT "order_items_line_total_check" CHECK ("line_total" = "unit_price" * "quantity");

ALTER TABLE "inventory_reservations"
    ADD CONSTRAINT "inventory_reservations_quantity_check" CHECK ("quantity" > 0);

ALTER TABLE "organization_counters"
    ADD CONSTRAINT "organization_counters_positive_check" CHECK ("last_order_number" >= 0);

CREATE TRIGGER "order_status_history_append_only"
    BEFORE UPDATE OR DELETE ON "order_status_history"
    FOR EACH ROW EXECUTE FUNCTION "append_only_block_changes"();
