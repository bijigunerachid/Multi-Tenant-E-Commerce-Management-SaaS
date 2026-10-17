-- A delivery's timestamps must agree with its status, and attempts never go negative.
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_status_check" CHECK (
  ("status" = 'SENT') = ("sent_at" IS NOT NULL)
  AND ("status" = 'FAILED') = ("failed_at" IS NOT NULL)
  AND "attempts" >= 0
);
