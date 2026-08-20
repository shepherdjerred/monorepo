-- Two-pass parlay generation: record the legs chosen before any number was
-- picked, and how the published price was measured.
--
-- Both are nullable because every definition written by the single-pass
-- generator predates them, and those rows must stay settleable unchanged.
ALTER TABLE "BucksParlayDefinition" ADD COLUMN "proposal" TEXT;
ALTER TABLE "BucksParlayDefinition" ADD COLUMN "pricing" TEXT;
