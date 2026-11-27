-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ActorKind" AS ENUM ('human', 'agent', 'runner');

-- CreateEnum
CREATE TYPE "ArtifactKind" AS ENUM ('html', 'site', 'image', 'video', 'pdf', 'markdown', 'cast', 'mermaid', 'file');

-- CreateEnum
CREATE TYPE "ThreadState" AS ENUM ('open', 'resolved');

-- CreateTable
CREATE TABLE "Actor" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" "ActorKind" NOT NULL,
    "name" TEXT NOT NULL,
    "workspaceKey" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seenCount" INTEGER NOT NULL DEFAULT 1,
    "metadata" JSONB NOT NULL,

    CONSTRAINT "Actor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Board" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "index" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "keep" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),
    "expiredAt" TIMESTAMP(3),

    CONSTRAINT "Board_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoardRevision" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "index" JSONB NOT NULL,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoardRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Artifact" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" "ArtifactKind" NOT NULL,
    "ownerKey" TEXT NOT NULL,
    "versionCounter" INTEGER NOT NULL DEFAULT 0,
    "currentVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Artifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Version" (
    "id" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "contentToken" TEXT NOT NULL,
    "entryPath" TEXT NOT NULL,
    "totalBytes" BIGINT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "viewport" JSONB,
    "posterSha256" TEXT,
    "publisherId" TEXT NOT NULL,
    "uploadId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "purgedAt" TIMESTAMP(3),

    CONSTRAINT "Version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VersionFile" (
    "versionId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,

    CONSTRAINT "VersionFile_pkey" PRIMARY KEY ("versionId","path")
);

-- CreateTable
CREATE TABLE "Blob" (
    "sha256" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "size" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Blob_pkey" PRIMARY KEY ("sha256")
);

-- CreateTable
CREATE TABLE "UploadSession" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestDigest" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "artifactId" TEXT,
    "request" JSONB NOT NULL,
    "expectedCurrentVersionId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "committedVersionId" TEXT,

    CONSTRAINT "UploadSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UploadFile" (
    "uploadId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "size" BIGINT NOT NULL,
    "mediaType" TEXT NOT NULL,

    CONSTRAINT "UploadFile_pkey" PRIMARY KEY ("uploadId","path")
);

-- CreateTable
CREATE TABLE "Thread" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "artifactId" TEXT,
    "versionId" TEXT,
    "anchor" JSONB NOT NULL,
    "state" "ThreadState" NOT NULL DEFAULT 'open',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Thread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Comment" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Delivery" (
    "commentId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ackedAt" TIMESTAMP(3),
    "handledAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Delivery_pkey" PRIMARY KEY ("commentId")
);

-- CreateTable
CREATE TABLE "Event" (
    "seq" BIGSERIAL NOT NULL,
    "boardId" TEXT,
    "kind" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" JSONB NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("seq")
);

-- CreateIndex
CREATE UNIQUE INDEX "Actor_key_key" ON "Actor"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Board_slug_key" ON "Board"("slug");

-- CreateIndex
CREATE INDEX "Board_archivedAt_idx" ON "Board"("archivedAt");

-- CreateIndex
CREATE INDEX "Board_lastActivityAt_idx" ON "Board"("lastActivityAt");

-- CreateIndex
CREATE UNIQUE INDEX "BoardRevision_boardId_revision_key" ON "BoardRevision"("boardId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "Artifact_currentVersionId_key" ON "Artifact"("currentVersionId");

-- CreateIndex
CREATE INDEX "Artifact_boardId_deletedAt_idx" ON "Artifact"("boardId", "deletedAt");

-- CreateIndex
CREATE INDEX "Artifact_ownerKey_idx" ON "Artifact"("ownerKey");

-- CreateIndex
CREATE UNIQUE INDEX "Version_contentToken_key" ON "Version"("contentToken");

-- CreateIndex
CREATE UNIQUE INDEX "Version_uploadId_key" ON "Version"("uploadId");

-- CreateIndex
CREATE UNIQUE INDEX "Version_artifactId_number_key" ON "Version"("artifactId", "number");

-- CreateIndex
CREATE INDEX "VersionFile_sha256_idx" ON "VersionFile"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "Blob_storageKey_key" ON "Blob"("storageKey");

-- CreateIndex
CREATE INDEX "Blob_createdAt_idx" ON "Blob"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "UploadSession_idempotencyKey_key" ON "UploadSession"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "UploadSession_committedVersionId_key" ON "UploadSession"("committedVersionId");

-- CreateIndex
CREATE INDEX "UploadSession_expiresAt_idx" ON "UploadSession"("expiresAt");

-- CreateIndex
CREATE INDEX "UploadSession_boardId_idx" ON "UploadSession"("boardId");

-- CreateIndex
CREATE INDEX "UploadFile_sha256_idx" ON "UploadFile"("sha256");

-- CreateIndex
CREATE INDEX "Thread_boardId_state_idx" ON "Thread"("boardId", "state");

-- CreateIndex
CREATE INDEX "Thread_artifactId_state_idx" ON "Thread"("artifactId", "state");

-- CreateIndex
CREATE INDEX "Comment_threadId_createdAt_idx" ON "Comment"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "Comment_updatedAt_idx" ON "Comment"("updatedAt");

-- CreateIndex
CREATE INDEX "Delivery_actorId_idx" ON "Delivery"("actorId");

-- CreateIndex
CREATE INDEX "Event_boardId_seq_idx" ON "Event"("boardId", "seq");

-- CreateIndex
CREATE INDEX "Event_occurredAt_idx" ON "Event"("occurredAt");

-- AddForeignKey
ALTER TABLE "BoardRevision" ADD CONSTRAINT "BoardRevision_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardRevision" ADD CONSTRAINT "BoardRevision_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Actor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "Version"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Version" ADD CONSTRAINT "Version_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "Artifact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Version" ADD CONSTRAINT "Version_publisherId_fkey" FOREIGN KEY ("publisherId") REFERENCES "Actor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Version" ADD CONSTRAINT "Version_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "UploadSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VersionFile" ADD CONSTRAINT "VersionFile_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "Version"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VersionFile" ADD CONSTRAINT "VersionFile_sha256_fkey" FOREIGN KEY ("sha256") REFERENCES "Blob"("sha256") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadSession" ADD CONSTRAINT "UploadSession_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadSession" ADD CONSTRAINT "UploadSession_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "Artifact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadSession" ADD CONSTRAINT "UploadSession_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Actor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadFile" ADD CONSTRAINT "UploadFile_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "UploadSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Thread" ADD CONSTRAINT "Thread_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Thread" ADD CONSTRAINT "Thread_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "Artifact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Thread" ADD CONSTRAINT "Thread_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "Version"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Thread" ADD CONSTRAINT "Thread_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Actor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "Thread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Actor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "Comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Actor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Actor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written constraints Prisma cannot express.

-- A content address is the lowercase hex SHA-256 of the bytes.
ALTER TABLE "Blob" ADD CONSTRAINT "Blob_sha256_check"
  CHECK ("sha256" ~ '^[0-9a-f]{64}$');
ALTER TABLE "VersionFile" ADD CONSTRAINT "VersionFile_sha256_check"
  CHECK ("sha256" ~ '^[0-9a-f]{64}$');
ALTER TABLE "UploadFile" ADD CONSTRAINT "UploadFile_sha256_check"
  CHECK ("sha256" ~ '^[0-9a-f]{64}$');
ALTER TABLE "Version" ADD CONSTRAINT "Version_posterSha256_check"
  CHECK ("posterSha256" IS NULL OR "posterSha256" ~ '^[0-9a-f]{64}$');

-- Revisions start at 1 and only grow.
ALTER TABLE "Board" ADD CONSTRAINT "Board_revision_check"
  CHECK ("revision" > 0);

-- The claim query scans only the deliveries an agent has not yet handled.
CREATE INDEX "Delivery_unhandled_idx" ON "Delivery" ("claimedAt")
  WHERE "handledAt" IS NULL;

-- Commit-ordered change notifications for the live stream. NOTIFY is queued
-- inside the writing transaction and delivered only when it commits. The
-- payload carries ids only: never a content token, comment body or path.
CREATE FUNCTION "artifacts_event_notify"() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify(
    'artifacts_events',
    json_build_object(
      'seq', NEW."seq",
      'boardId', NEW."boardId",
      'kind', NEW."kind"
    )::text
  );
  RETURN NULL;
END
$$ LANGUAGE plpgsql;
CREATE TRIGGER "Event_notify" AFTER INSERT ON "Event"
  FOR EACH ROW EXECUTE FUNCTION "artifacts_event_notify"();
