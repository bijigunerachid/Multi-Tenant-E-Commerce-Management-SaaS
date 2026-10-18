-- CreateEnum
CREATE TYPE "webhook_event_status" AS ENUM ('RECEIVED', 'PROCESSED', 'FAILED');

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider" VARCHAR(20) NOT NULL,
    "event_id" VARCHAR(120) NOT NULL,
    "type" VARCHAR(80) NOT NULL,
    "organization_id" UUID,
    "status" "webhook_event_status" NOT NULL DEFAULT 'RECEIVED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" VARCHAR(500),
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_invoices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "provider" VARCHAR(20) NOT NULL,
    "provider_invoice_id" VARCHAR(120) NOT NULL,
    "number" VARCHAR(60),
    "status" VARCHAR(20) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "amount_due" DECIMAL(12,2) NOT NULL,
    "amount_paid" DECIMAL(12,2) NOT NULL,
    "period_start" TIMESTAMPTZ(3),
    "period_end" TIMESTAMPTZ(3),
    "hosted_invoice_url" VARCHAR(1000),
    "invoice_pdf_url" VARCHAR(1000),
    "issued_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "billing_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "webhook_events_status_received_at_idx" ON "webhook_events"("status", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_provider_event_id_key" ON "webhook_events"("provider", "event_id");

-- CreateIndex
CREATE INDEX "billing_invoices_organization_id_issued_at_idx" ON "billing_invoices"("organization_id", "issued_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "billing_invoices_provider_provider_invoice_id_key" ON "billing_invoices"("provider", "provider_invoice_id");

-- AddForeignKey
ALTER TABLE "billing_invoices" ADD CONSTRAINT "billing_invoices_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Amounts are never negative; currency codes are upper case.
ALTER TABLE "billing_invoices" ADD CONSTRAINT "billing_invoices_amounts_check"
  CHECK ("amount_due" >= 0 AND "amount_paid" >= 0 AND "currency" ~ '^[A-Z]{3}$');
-- A processed event has its processing time, and only then.
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_processed_check"
  CHECK (("status" = 'PROCESSED') = ("processed_at" IS NOT NULL) AND "attempts" >= 0);
