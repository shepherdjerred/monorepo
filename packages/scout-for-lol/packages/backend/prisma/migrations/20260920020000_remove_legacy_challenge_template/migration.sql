-- Remove legacy generic challenge template and any associated runs

DELETE FROM "ChallengeActiveRun" WHERE "templateId" IN (
  SELECT "id" FROM "ChallengeTemplate" WHERE "slug" = 'scout-win-every-current-champion'
);

DELETE FROM "ChallengeRunEvidence" WHERE "runId" IN (
  SELECT "id" FROM "ChallengeRun" WHERE "templateId" IN (
    SELECT "id" FROM "ChallengeTemplate" WHERE "slug" = 'scout-win-every-current-champion'
  )
);

DELETE FROM "ChallengeRunCursor" WHERE "runId" IN (
  SELECT "id" FROM "ChallengeRun" WHERE "templateId" IN (
    SELECT "id" FROM "ChallengeTemplate" WHERE "slug" = 'scout-win-every-current-champion'
  )
);

DELETE FROM "ChallengeRunMatchTrigger" WHERE "runId" IN (
  SELECT "id" FROM "ChallengeRun" WHERE "templateId" IN (
    SELECT "id" FROM "ChallengeTemplate" WHERE "slug" = 'scout-win-every-current-champion'
  )
);

DELETE FROM "ChallengeRunSnapshot" WHERE "runId" IN (
  SELECT "id" FROM "ChallengeRun" WHERE "templateId" IN (
    SELECT "id" FROM "ChallengeTemplate" WHERE "slug" = 'scout-win-every-current-champion'
  )
);

DELETE FROM "ChallengeRunRevision" WHERE "runId" IN (
  SELECT "id" FROM "ChallengeRun" WHERE "templateId" IN (
    SELECT "id" FROM "ChallengeTemplate" WHERE "slug" = 'scout-win-every-current-champion'
  )
);

DELETE FROM "ChallengeRun" WHERE "templateId" IN (
  SELECT "id" FROM "ChallengeTemplate" WHERE "slug" = 'scout-win-every-current-champion'
);

DELETE FROM "ChallengeTemplateVersion" WHERE "templateId" IN (
  SELECT "id" FROM "ChallengeTemplate" WHERE "slug" = 'scout-win-every-current-champion'
);

DELETE FROM "ChallengeTemplate" WHERE "slug" = 'scout-win-every-current-champion';

-- Ensure any remaining persisted evidence rows have placement: null if omitted
UPDATE "ChallengeRunEvidence"
SET "evidenceJson" = jsonb_set("evidenceJson"::jsonb, '{placement}', 'null'::jsonb)::text
WHERE ("evidenceJson"::jsonb ? 'placement') = false;
