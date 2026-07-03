-- Per-subscription notification filters (starts with queue types; extensible).
-- Nullable, no default, no backfill: existing rows become NULL = notify all,
-- preserving today's all-or-nothing behavior. Stored as JSON TEXT and validated
-- in the app via Zod (SubscriptionFilterSpec); never queried in SQL.
ALTER TABLE "Subscription" ADD COLUMN "filters" TEXT;
