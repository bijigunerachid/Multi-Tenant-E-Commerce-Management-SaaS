-- CreateIndex
CREATE INDEX "orders_organization_id_shipped_at_idx" ON "orders"("organization_id", "shipped_at");
