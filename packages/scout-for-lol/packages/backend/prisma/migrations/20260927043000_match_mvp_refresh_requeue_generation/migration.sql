ALTER TABLE "MatchMvpTallyRefresh"
    ADD COLUMN "requeueGeneration" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "targetProgress" JSONB NOT NULL DEFAULT '{}'::jsonb;
