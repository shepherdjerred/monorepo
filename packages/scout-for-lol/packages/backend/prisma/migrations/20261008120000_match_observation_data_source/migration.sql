-- MatchObservation.matchDataSource: where the match's canonical payload came
-- from. RIOT is Match-V5; SCOUT_CLIENT is a paired client's capture, selected
-- only after Riot returned nothing for the gap-fill delay and recorded in
-- ScoutClientCanonicalMatch. The observation commit writes it from then on.
--
-- The default is the backfill for rows that predate the column: every
-- observation is Riot-sourced unless a client capture was selected for it, and
-- that selection is the one durable record of the other case.
ALTER TABLE "MatchObservation"
  ADD COLUMN "matchDataSource" TEXT NOT NULL DEFAULT 'RIOT';

UPDATE "MatchObservation" AS o
   SET "matchDataSource" = 'SCOUT_CLIENT'
 WHERE EXISTS (
   SELECT 1
     FROM "ScoutClientCanonicalMatch" AS c
    WHERE c."riotMatchId" = o."riotMatchId"
 );

-- Mirrors the domain's MatchDataSource enum (match-processing/states).
ALTER TABLE "MatchObservation"
  ADD CONSTRAINT "MatchObservation_match_data_source_check"
  CHECK ("matchDataSource" IN ('RIOT', 'SCOUT_CLIENT'));
