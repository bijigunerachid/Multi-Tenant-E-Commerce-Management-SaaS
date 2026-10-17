-- AlterTable
ALTER TABLE "organization_memberships" ADD COLUMN     "email_notifications" VARCHAR(60)[] DEFAULT ARRAY[]::VARCHAR(60)[];

-- CreateTable
CREATE TABLE "notification_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "type" VARCHAR(60) NOT NULL,
    "payload" JSONB NOT NULL,
    "actor_user_id" UUID,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" VARCHAR(500),
    "processed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "type" VARCHAR(60) NOT NULL,
    "data" JSONB NOT NULL,
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notification_events_created_at_idx" ON "notification_events"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_events_organization_id_id_key" ON "notification_events"("organization_id", "id");

-- CreateIndex
CREATE INDEX "notifications_organization_id_membership_id_created_at_idx" ON "notifications"("organization_id", "membership_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "notifications_event_id_membership_id_key" ON "notifications"("event_id", "membership_id");

-- AddForeignKey
ALTER TABLE "notification_events" ADD CONSTRAINT "notification_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_membership_id_fkey" FOREIGN KEY ("organization_id", "membership_id") REFERENCES "organization_memberships"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
