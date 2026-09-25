-- A durable claim on one prematch pass.
--
-- Every scheduled prematch poll now takes this claim before it detects live
-- games, whichever pipeline (v1 or V2) owns the pass, so two overlapping
-- polls can never both detect and announce the same game. The holder is the
-- claiming Workflow run's ID; its renewal keeps a long pass live, and a claim
-- whose start and last renewal are both past the staleness bound may be taken
-- over. NULL means unclaimed, which is every existing row, so this changes
-- nothing already standing.
ALTER TABLE "BotState" ADD COLUMN "prematchPassHolder" TEXT;
ALTER TABLE "BotState" ADD COLUMN "prematchPassClaimedAt" TIMESTAMP(3);
ALTER TABLE "BotState" ADD COLUMN "prematchPassRenewedAt" TIMESTAMP(3);
