-- Expand the intent subject before Duel and Dare producers begin writing.
-- Keep old match writers valid during the rolling deployment: they do not
-- provide subjectId, so NULL there means the existing riotMatchId only for
-- subjectKind=match. New writers always populate both columns.
ALTER TABLE "MatchNotificationIntent"
  ADD COLUMN "subjectKind" TEXT NOT NULL DEFAULT 'match',
  ADD COLUMN "subjectId" TEXT;

UPDATE "MatchNotificationIntent"
SET "subjectId" = "riotMatchId";

ALTER TABLE "MatchNotificationIntent"
  ALTER COLUMN "riotMatchId" DROP NOT NULL;

ALTER TABLE "MatchNotificationIntent"
  DROP CONSTRAINT "MatchNotificationIntent_riot_match_id_format_check";

ALTER TABLE "MatchNotificationIntent"
  ADD CONSTRAINT "MatchNotificationIntent_subject_check"
  CHECK (
    (
      "subjectKind" = 'match'
      AND "riotMatchId" IS NOT NULL
      AND "riotMatchId" ~ '^[A-Z0-9]+_[0-9]+$'
      AND ("subjectId" IS NULL OR "subjectId" = "riotMatchId")
    ) OR (
      "subjectKind" IN ('duel', 'dare')
      AND "riotMatchId" IS NULL
      AND "subjectId" IS NOT NULL
      AND char_length("subjectId") > 0
    )
  );

CREATE INDEX "MatchNotificationIntent_subjectKind_subjectId_idx"
ON "MatchNotificationIntent"("subjectKind", "subjectId");
