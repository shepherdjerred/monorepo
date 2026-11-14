CREATE TYPE "ForumKind" AS ENUM ('notice', 'discussion');
CREATE TYPE "ForumState" AS ENUM ('open', 'resolved');
CREATE TABLE "ForumPost" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "kind" "ForumKind" NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "exitCondition" TEXT,
  "expiresAt" TIMESTAMP(3),
  "state" "ForumState" NOT NULL DEFAULT 'open',
  "creatorId" TEXT NOT NULL REFERENCES "Actor"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "resolverId" TEXT REFERENCES "Actor"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "resolutionNote" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ForumPost_notice_condition" CHECK ("kind" <> 'notice' OR length(trim("exitCondition")) > 0 AND "exitCondition" IS NOT NULL),
  CONSTRAINT "ForumPost_discussion_fields" CHECK ("kind" <> 'discussion' OR ("exitCondition" IS NULL AND "expiresAt" IS NULL))
);
CREATE INDEX "ForumPost_kind_state_updatedAt_id_idx" ON "ForumPost"("kind", "state", "updatedAt", "id");
CREATE INDEX "ForumPost_scopes_idx" ON "ForumPost" USING GIN ("scopes");
CREATE TABLE "ForumReply" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "postId" TEXT NOT NULL REFERENCES "ForumPost"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "authorId" TEXT NOT NULL REFERENCES "Actor"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "ForumReply_postId_createdAt_id_idx" ON "ForumReply"("postId", "createdAt", "id");
