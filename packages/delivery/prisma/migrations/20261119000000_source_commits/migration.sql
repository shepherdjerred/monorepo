-- A main commit's title and author, read from its exact Woodpecker push
-- pipeline when a build of it is qualified. Additive: the serving revision
-- neither reads nor writes this table.
CREATE TABLE "SourceCommit" (
  "sourceRevision" TEXT NOT NULL,
  "title" TEXT,
  "author" TEXT,
  "pipelineNumber" INTEGER NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SourceCommit_pkey" PRIMARY KEY ("sourceRevision"),
  CONSTRAINT "SourceCommit_title_check" CHECK ("title" IS NULL OR ("title" <> '' AND char_length("title") <= 200)),
  CONSTRAINT "SourceCommit_author_check" CHECK ("author" IS NULL OR "author" <> '')
);

-- Backfill from the Woodpecker pipelines the CI panel already cached. A cached
-- run carries no commit sha, so the commit comes from a CI build whose
-- qualification read that pipeline and proved it the main push of exactly the
-- build's source revision: a verified build, or one failed with the reason
-- recorded only after that identity check passed. A pending build, or one
-- failed for any other reason, proves no such thing and is left out, as is
-- every commit whose pipeline was never opened in the hub; those get no row,
-- which the hub reads as "predates capture". A commit rerun under several
-- pipelines takes its first, matching first-write-wins capture.
INSERT INTO "SourceCommit" ("sourceRevision", "title", "author", "pipelineNumber")
SELECT DISTINCT ON (b."sourceRevision")
  b."sourceRevision",
  NULLIF(left(btrim(split_part(s."payload"->>'message', E'\n', 1), E' \t\r'), 200), ''),
  NULLIF(btrim(s."payload"->>'author', E' \t\r\n'), ''),
  b."pipelineNumber"
FROM "Build" b
JOIN "IntegrationSnapshot" s
  ON s."source" = 'woodpecker'
  AND s."key" = b."repositoryId"::text || '/' || b."pipelineNumber"::text
WHERE b."sourceKind" = 'ci'
  AND (
    b."status" = 'verified'
    OR (b."status" = 'failed' AND b."qualificationReason" = 'CI pipeline did not pass exact main push verification')
  )
  AND jsonb_typeof(s."payload"->'message') = 'string'
  AND jsonb_typeof(s."payload"->'author') = 'string'
  AND s."payload"->>'event' = 'push'
  AND s."payload"->>'branch' = 'main'
ORDER BY b."sourceRevision", b."pipelineNumber";
