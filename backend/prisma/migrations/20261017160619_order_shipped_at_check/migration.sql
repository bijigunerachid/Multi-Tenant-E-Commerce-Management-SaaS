-- Only shipped or delivered orders have a ship date (set by the "ship" transition).
-- Reports rely on it: revenue is counted by shipped_at.
ALTER TABLE "orders"
    ADD CONSTRAINT "orders_shipped_at_check"
    CHECK (("status" IN ('SHIPPED', 'DELIVERED')) = ("shipped_at" IS NOT NULL));
