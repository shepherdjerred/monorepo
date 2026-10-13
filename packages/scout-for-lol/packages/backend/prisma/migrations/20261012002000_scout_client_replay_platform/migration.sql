ALTER TABLE "ScoutClientReplayArtifact" ADD COLUMN "platformId" TEXT;
CREATE INDEX "ScoutClientReplayArtifact_platformId_gameId_uploadState_idx" ON "ScoutClientReplayArtifact"("platformId", "gameId", "uploadState");
