-- Multiple-choice coach answers, and the key that bounds app-started turns.

-- AlterTable
ALTER TABLE "ExploreMessage" ADD COLUMN "coachOptions" TEXT;

-- AlterTable
ALTER TABLE "ScoutCoachTurn" ADD COLUMN "gameKey" TEXT;

-- CreateIndex
CREATE INDEX "ScoutCoachTurn_ownerId_initiation_gameKey_idx" ON "ScoutCoachTurn"("ownerId", "initiation", "gameKey");

-- `app_initiated` was never written: no route started a turn on its own until
-- now. The two initiations the app route writes replace it, and an app-started
-- turn always names the game it belongs to.
ALTER TABLE "ScoutCoachTurn" DROP CONSTRAINT "ScoutCoachTurn_initiation_check";

ALTER TABLE "ScoutCoachTurn" ADD CONSTRAINT "ScoutCoachTurn_initiation_check"
  CHECK ("initiation" IN ('player_typed', 'app_champ_select', 'app_pregame'));

ALTER TABLE "ScoutCoachTurn" ADD CONSTRAINT "ScoutCoachTurn_game_key_check"
  CHECK (("initiation" = 'player_typed') = ("gameKey" IS NULL));

-- Live state never reaches an app-started turn, whatever the writer says.
ALTER TABLE "ScoutCoachTurn" ADD CONSTRAINT "ScoutCoachTurn_app_no_live_check"
  CHECK ("initiation" = 'player_typed' OR NOT ('live' = ANY("sectionsAccepted")));
