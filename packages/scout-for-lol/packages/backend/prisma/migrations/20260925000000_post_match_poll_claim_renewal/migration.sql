-- Let the holder of a durable post-match poll claim renew it.
--
-- A claim is stale, and may be taken over, once it has stood past the
-- staleness bound. A delegated v1 pass can legitimately run longer than that
-- bound while it ingests a backlog, so its owner renews the claim while it is
-- alive, and the claim goes stale only when neither its start nor its last
-- renewal is inside the bound. NULL means never renewed, which is every
-- existing row, so this changes nothing already standing.
ALTER TABLE "BotState" ADD COLUMN "pollClaimRenewedAt" TIMESTAMP(3);
