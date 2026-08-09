ALTER TABLE "ActiveGame" ADD COLUMN "prematchMatchId" TEXT;
CREATE UNIQUE INDEX "ActiveGame_prematchMatchId_key" ON "ActiveGame"("prematchMatchId");
