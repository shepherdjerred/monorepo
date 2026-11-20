-- A spoken coach turn records how it began and how the server judged the wake
-- phrase, beside the run it started (`coach/voice/turns`).
-- AlterTable
ALTER TABLE "ScoutCoachTurn" ADD COLUMN "voiceTrigger" TEXT,
ADD COLUMN "wakeVerification" TEXT;

-- `player_voice` joins the vocabulary, as a turn the player started: like a
-- typed one it names no game key and may carry live state.
ALTER TABLE "ScoutCoachTurn" DROP CONSTRAINT "ScoutCoachTurn_initiation_check";
ALTER TABLE "ScoutCoachTurn" ADD CONSTRAINT "ScoutCoachTurn_initiation_check"
  CHECK ("initiation" IN ('player_typed', 'player_voice', 'app_champ_select', 'app_pregame'));

ALTER TABLE "ScoutCoachTurn" DROP CONSTRAINT "ScoutCoachTurn_game_key_check";
ALTER TABLE "ScoutCoachTurn" ADD CONSTRAINT "ScoutCoachTurn_game_key_check"
  CHECK (("initiation" IN ('player_typed', 'player_voice')) = ("gameKey" IS NULL));

ALTER TABLE "ScoutCoachTurn" DROP CONSTRAINT "ScoutCoachTurn_app_no_live_check";
ALTER TABLE "ScoutCoachTurn" ADD CONSTRAINT "ScoutCoachTurn_app_no_live_check"
  CHECK ("initiation" IN ('player_typed', 'player_voice') OR NOT ('live' = ANY("sectionsAccepted")));

-- The proof of a spoken turn is stored, not implied: a voice turn names its
-- trigger and verification, a wake-word turn is one the server verified, and
-- no other initiation carries either column.
ALTER TABLE "ScoutCoachTurn" ADD CONSTRAINT "ScoutCoachTurn_voice_check"
  CHECK (
    ("initiation" = 'player_voice') = ("voiceTrigger" IS NOT NULL)
    AND ("voiceTrigger" IS NULL) = ("wakeVerification" IS NULL)
    AND ("voiceTrigger" IS NULL OR "voiceTrigger" IN ('wake_word', 'push_to_talk'))
    AND ("voiceTrigger" <> 'wake_word' OR "wakeVerification" = 'verified')
    AND ("voiceTrigger" <> 'push_to_talk' OR "wakeVerification" = 'not_required')
  );
