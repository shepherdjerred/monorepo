-- `origin` is a closed enum (`ExploreConversationOriginSchema` in
-- data/src/model/reports/explore.ts) that every reader parses strictly, so
-- the database holds it to the same set. `desktop` is Scout Desktop acting as
-- its owner through an `explore`-scoped device credential.
ALTER TABLE "ExploreConversation" ADD CONSTRAINT "ExploreConversation_origin_check"
  CHECK ("origin" IN ('legacy', 'web', 'discord', 'voice', 'desktop'));
