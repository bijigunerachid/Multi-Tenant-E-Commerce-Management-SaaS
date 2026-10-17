-- CreateEnum
CREATE TYPE "inventory_movement_type" AS ENUM ('RECEIPT', 'ADJUSTMENT', 'RESERVE', 'RELEASE', 'FULFIL');

-- CreateEnum
CREATE TYPE "adjustment_reason" AS ENUM ('COUNT_CORRECTION', 'DAMAGED', 'LOST', 'FOUND', 'RETURNED', 'OTHER');

-- CreateTable
CREATE TABLE "inventory_levels" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "on_hand" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "inventory_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_movements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "inventory_level_id" UUID NOT NULL,
    "type" "inventory_movement_type" NOT NULL,
    "on_hand_delta" INTEGER NOT NULL,
    "reserved_delta" INTEGER NOT NULL,
    "on_hand_after" INTEGER NOT NULL,
    "reserved_after" INTEGER NOT NULL,
    "reason" "adjustment_reason",
    "note" VARCHAR(500),
    "actor_user_id" UUID,
    "order_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inventory_levels_organization_id_variant_id_idx" ON "inventory_levels"("organization_id", "variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_levels_organization_id_store_id_variant_id_key" ON "inventory_levels"("organization_id", "store_id", "variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_levels_organization_id_id_key" ON "inventory_levels"("organization_id", "id");

-- CreateIndex
CREATE INDEX "inventory_movements_organization_id_created_at_idx" ON "inventory_movements"("organization_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "inventory_movements_organization_id_inventory_level_id_crea_idx" ON "inventory_movements"("organization_id", "inventory_level_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "inventory_levels" ADD CONSTRAINT "inventory_levels_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_levels" ADD CONSTRAINT "inventory_levels_organization_id_store_id_fkey" FOREIGN KEY ("organization_id", "store_id") REFERENCES "stores"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_levels" ADD CONSTRAINT "inventory_levels_organization_id_variant_id_fkey" FOREIGN KEY ("organization_id", "variant_id") REFERENCES "product_variants"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_organization_id_inventory_level_id_fkey" FOREIGN KEY ("organization_id", "inventory_level_id") REFERENCES "inventory_levels"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Invariants Prisma cannot express (see docs/data-model.md).
-- Stock can never be negative and never more reserved than on hand, whatever the code does.
ALTER TABLE "inventory_levels"
    ADD CONSTRAINT "inventory_levels_on_hand_check" CHECK ("on_hand" >= 0),
    ADD CONSTRAINT "inventory_levels_reserved_check" CHECK ("reserved" >= 0 AND "reserved" <= "on_hand");

ALTER TABLE "inventory_movements"
    ADD CONSTRAINT "inventory_movements_after_check" CHECK ("on_hand_after" >= 0 AND "reserved_after" >= 0 AND "reserved_after" <= "on_hand_after"),
    ADD CONSTRAINT "inventory_movements_nonzero_check" CHECK ("on_hand_delta" <> 0 OR "reserved_delta" <> 0),
    ADD CONSTRAINT "inventory_movements_reason_check" CHECK (("type" = 'ADJUSTMENT') = ("reason" IS NOT NULL));

-- Generic append-only guard, reusable by any history table.
CREATE FUNCTION "append_only_block_changes"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION '% is append-only (% blocked)', TG_TABLE_NAME, TG_OP;
END;
$$;

CREATE TRIGGER "inventory_movements_append_only"
    BEFORE UPDATE OR DELETE ON "inventory_movements"
    FOR EACH ROW EXECUTE FUNCTION "append_only_block_changes"();
