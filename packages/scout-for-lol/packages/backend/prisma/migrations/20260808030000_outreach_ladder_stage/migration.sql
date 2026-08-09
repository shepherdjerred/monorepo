-- Separate "which ladder rung have we delivered?" from "how much budget is
-- spent?". Reusing outreachStage for both meant a guild that configured before
-- its first message stayed on rung 1 forever (nothing delivered ⇒ counter never
-- moved), so it could never reach the day-14 feedback ask.
ALTER TABLE "GuildInstall" ADD COLUMN "lastLadderStage" INTEGER NOT NULL DEFAULT 0;

-- Seed from delivered history: the rung reached is at least the number of
-- non-core messages already delivered.
UPDATE "GuildInstall" SET "lastLadderStage" = "outreachStage";
