-- Beta-only proactive coach turns (`coach/triggers`): the receipts that bound
-- them, and the initiation their audit rows carry. Production refuses the
-- route, so no production row of either is ever written.

-- CreateTable
CREATE TABLE "ScoutCoachTriggerReceipt" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "gameKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "windowKey" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScoutCoachTriggerReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScoutCoachTriggerReceipt_runId_key" ON "ScoutCoachTriggerReceipt"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "ScoutCoachTriggerReceipt_ownerId_gameKey_kind_windowKey_key" ON "ScoutCoachTriggerReceipt"("ownerId", "gameKey", "kind", "windowKey");

-- CreateIndex
CREATE INDEX "ScoutCoachTriggerReceipt_ownerId_createdAt_idx" ON "ScoutCoachTriggerReceipt"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "ScoutCoachTriggerReceipt_deviceId_idx" ON "ScoutCoachTriggerReceipt"("deviceId");

-- AddForeignKey
ALTER TABLE "ScoutCoachTriggerReceipt" ADD CONSTRAINT "ScoutCoachTriggerReceipt_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("discordId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoutCoachTriggerReceipt" ADD CONSTRAINT "ScoutCoachTriggerReceipt_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "ScoutClientDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A trigger kind the coach contract does not name is a writer bug.
ALTER TABLE "ScoutCoachTriggerReceipt" ADD CONSTRAINT "ScoutCoachTriggerReceipt_kind_check"
  CHECK ("kind" IN ('enemy_item_spike', 'enemy_fed', 'damage_profile_shift', 'healing_threat', 'death_streak'));

-- The audit vocabulary gains the proactive initiation. The list is the union
-- of every initiation shipped before this migration (the spoken turn and the
-- post-game review) so the check is right whichever order they apply in.
ALTER TABLE "ScoutCoachTurn" DROP CONSTRAINT "ScoutCoachTurn_initiation_check";

ALTER TABLE "ScoutCoachTurn" ADD CONSTRAINT "ScoutCoachTurn_initiation_check"
  CHECK ("initiation" IN ('player_typed', 'player_voice', 'app_champ_select', 'app_pregame', 'app_postgame', 'app_proactive'));

-- Live state reaches a turn the player did not start only on a proactive one;
-- champ-select and pre-game turns still never carry it.
ALTER TABLE "ScoutCoachTurn" DROP CONSTRAINT "ScoutCoachTurn_app_no_live_check";

ALTER TABLE "ScoutCoachTurn" ADD CONSTRAINT "ScoutCoachTurn_app_no_live_check"
  CHECK ("initiation" IN ('player_typed', 'player_voice', 'app_proactive') OR NOT ('live' = ANY("sectionsAccepted")));

-- A proactive turn carries live state and nothing else.
ALTER TABLE "ScoutCoachTurn" ADD CONSTRAINT "ScoutCoachTurn_proactive_live_only_check"
  CHECK ("initiation" <> 'app_proactive' OR "sectionsAccepted" = ARRAY['live']::TEXT[]);
