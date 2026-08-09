ALTER TABLE "ActiveGame" ADD COLUMN "prematchMatchId" TEXT;
DROP INDEX "ActiveGame_gameId_key";
CREATE UNIQUE INDEX "ActiveGame_prematchMatchId_key" ON "ActiveGame"("prematchMatchId");
