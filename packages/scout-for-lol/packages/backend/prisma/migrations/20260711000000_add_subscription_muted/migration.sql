-- Per-subscription mute: suppresses pre/post-match notifications without
-- deleting the subscription. Default false so existing rows keep notifying.
ALTER TABLE "Subscription" ADD COLUMN "isMuted" BOOLEAN NOT NULL DEFAULT false;
