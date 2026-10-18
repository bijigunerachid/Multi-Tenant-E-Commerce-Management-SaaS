-- CreateEnum
CREATE TYPE "subscription_status" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED');

-- CreateTable
CREATE TABLE "subscription_plans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "price_monthly" DECIMAL(12,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "limits" JSONB NOT NULL,
    "features" JSONB NOT NULL,
    "provider_price_id" VARCHAR(120),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "subscription_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "status" "subscription_status" NOT NULL,
    "trial_ends_at" TIMESTAMPTZ(3),
    "current_period_end" TIMESTAMPTZ(3),
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "provider" VARCHAR(20),
    "provider_customer_id" VARCHAR(120),
    "provider_subscription_id" VARCHAR(120),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "subscription_plans_code_key" ON "subscription_plans"("code");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_organization_id_key" ON "subscriptions"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_provider_subscription_id_key" ON "subscriptions"("provider_subscription_id");

-- CreateIndex
CREATE INDEX "subscriptions_status_trial_ends_at_idx" ON "subscriptions"("status", "trial_ends_at");

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "subscription_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A trial has an end date; prices are not negative; a plan's limits name all three resources.
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_trial_check"
  CHECK ("status" <> 'TRIALING' OR "trial_ends_at" IS NOT NULL);
ALTER TABLE "subscription_plans" ADD CONSTRAINT "subscription_plans_price_check"
  CHECK ("price_monthly" >= 0);
ALTER TABLE "subscription_plans" ADD CONSTRAINT "subscription_plans_limits_check"
  CHECK ("limits" ?& ARRAY['stores', 'members', 'products']);

-- The plans. Reference data lives in migrations so every environment has the same plans;
-- prices are in USD per month. Test and E2E resets keep this table.
INSERT INTO "subscription_plans" ("code", "name", "price_monthly", "currency", "limits", "features", "position", "updated_at") VALUES
  ('starter', 'Starter', 29.00, 'USD', '{"stores": 1, "members": 3, "products": 100}', '{"csvExport": false}', 1, now()),
  ('growth', 'Growth', 79.00, 'USD', '{"stores": 3, "members": 10, "products": 1000}', '{"csvExport": true}', 2, now()),
  ('scale', 'Scale', 199.00, 'USD', '{"stores": 10, "members": 50, "products": 10000}', '{"csvExport": true}', 3, now());

-- Organizations created before plans existed start a 14-day Growth trial today.
INSERT INTO "subscriptions" ("organization_id", "plan_id", "status", "trial_ends_at", "updated_at")
SELECT o."id", p."id", 'TRIALING', now() + interval '14 days', now()
FROM "organizations" o CROSS JOIN "subscription_plans" p
WHERE p."code" = 'growth';
