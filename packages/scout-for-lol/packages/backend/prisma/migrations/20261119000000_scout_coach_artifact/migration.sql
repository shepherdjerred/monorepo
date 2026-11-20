-- What the coach produced for one finished game the owner recorded: the
-- post-game review. One row per owner, match and kind.

-- CreateTable
CREATE TABLE "ScoutCoachArtifact" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "runId" TEXT,
    "conversationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScoutCoachArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScoutCoachArtifact_runId_key" ON "ScoutCoachArtifact"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "ScoutCoachArtifact_ownerId_matchId_kind_key" ON "ScoutCoachArtifact"("ownerId", "matchId", "kind");

-- CreateIndex
CREATE INDEX "ScoutCoachArtifact_ownerId_createdAt_idx" ON "ScoutCoachArtifact"("ownerId", "createdAt");

-- AddForeignKey
ALTER TABLE "ScoutCoachArtifact" ADD CONSTRAINT "ScoutCoachArtifact_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("discordId") ON DELETE CASCADE ON UPDATE CASCADE;

-- The vocabulary is closed: a kind or status the coach does not name is a
-- writer bug, refused here rather than stored.
ALTER TABLE "ScoutCoachArtifact" ADD CONSTRAINT "ScoutCoachArtifact_kind_check"
  CHECK ("kind" IN ('review'));

ALTER TABLE "ScoutCoachArtifact" ADD CONSTRAINT "ScoutCoachArtifact_status_check"
  CHECK ("status" IN ('pending', 'ready', 'declined', 'failed'));

-- The server starts the post-game review, as a third app initiation; like the
-- others it names its game and never carries live state (the existing
-- app_no_live and game_key checks already cover it, and it is no voice turn,
-- so voice_check keeps its voice columns null).
ALTER TABLE "ScoutCoachTurn" DROP CONSTRAINT "ScoutCoachTurn_initiation_check";

ALTER TABLE "ScoutCoachTurn" ADD CONSTRAINT "ScoutCoachTurn_initiation_check"
  CHECK ("initiation" IN ('player_typed', 'player_voice', 'app_champ_select', 'app_pregame', 'app_postgame'));
