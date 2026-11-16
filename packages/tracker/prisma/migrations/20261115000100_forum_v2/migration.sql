CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Reserve the FM key prefix for forum threads.
ALTER TABLE "Team" ADD CONSTRAINT "Team_reserved_key_check" CHECK ("key" <> 'FM');

-- Sequential FM-<number> identifiers for forum posts.
CREATE SEQUENCE "ForumPost_number_seq" AS INTEGER;
ALTER TABLE "ForumPost" ADD COLUMN "number" INTEGER;
WITH numbered AS (
  SELECT "id", ROW_NUMBER() OVER (ORDER BY "createdAt" ASC, "id" ASC) AS rn
  FROM "ForumPost"
)
UPDATE "ForumPost" p
SET "number" = n.rn
FROM numbered n
WHERE p."id" = n."id";
SELECT setval(
  '"ForumPost_number_seq"',
  COALESCE((SELECT MAX("number") FROM "ForumPost"), 1),
  EXISTS (SELECT 1 FROM "ForumPost")
);
ALTER TABLE "ForumPost" ALTER COLUMN "number" SET DEFAULT nextval('"ForumPost_number_seq"');
ALTER TABLE "ForumPost" ALTER COLUMN "number" SET NOT NULL;
ALTER SEQUENCE "ForumPost_number_seq" OWNED BY "ForumPost"."number";
CREATE UNIQUE INDEX "ForumPost_number_key" ON "ForumPost"("number");
ALTER TABLE "ForumPost" ADD CONSTRAINT "ForumPost_number_check" CHECK ("number" > 0);

-- ForumPost v2 columns, backfills, foreign keys, checks, and indexes.
ALTER TABLE "ForumPost"
  ADD COLUMN "ownerId" TEXT,
  ADD COLUMN "projectId" TEXT,
  ADD COLUMN "pinnedAt" TIMESTAMP(3),
  ADD COLUMN "pinnedById" TEXT,
  ADD COLUMN "acceptedReplyId" TEXT,
  ADD COLUMN "editedAt" TIMESTAMP(3),
  ADD COLUMN "replyCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "voteCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "lastReplyAt" TIMESTAMP(3),
  ADD COLUMN "lastReplyAuthorId" TEXT,
  ADD COLUMN "searchVector" tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("body", '')), 'B') ||
    setweight(to_tsvector('english', coalesce("exitCondition", '')), 'C')
  ) STORED;

UPDATE "ForumPost" p
SET
  "replyCount" = (SELECT COUNT(*)::int FROM "ForumReply" r WHERE r."postId" = p."id"),
  "lastActivityAt" = GREATEST(
    p."updatedAt",
    COALESCE((SELECT MAX(r."createdAt") FROM "ForumReply" r WHERE r."postId" = p."id"), p."createdAt")
  ),
  "lastReplyAt" = (
    SELECT r."createdAt" FROM "ForumReply" r
    WHERE r."postId" = p."id"
    ORDER BY r."createdAt" DESC, r."id" DESC
    LIMIT 1
  ),
  "lastReplyAuthorId" = (
    SELECT r."authorId" FROM "ForumReply" r
    WHERE r."postId" = p."id"
    ORDER BY r."createdAt" DESC, r."id" DESC
    LIMIT 1
  );

ALTER TABLE "ForumPost" DROP CONSTRAINT "ForumPost_discussion_fields";
ALTER TABLE "ForumPost" ADD CONSTRAINT "ForumPost_non_notice_fields"
  CHECK ("kind" = 'notice' OR ("exitCondition" IS NULL AND "expiresAt" IS NULL AND "ownerId" IS NULL));
ALTER TABLE "ForumPost" ADD CONSTRAINT "ForumPost_accepted_reply_kind_check"
  CHECK ("acceptedReplyId" IS NULL OR "kind" = 'question');
ALTER TABLE "ForumPost" ADD CONSTRAINT "ForumPost_replyCount_check" CHECK ("replyCount" >= 0);
ALTER TABLE "ForumPost" ADD CONSTRAINT "ForumPost_voteCount_check" CHECK ("voteCount" >= 0);

ALTER TABLE "ForumPost" ADD CONSTRAINT "ForumPost_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "Actor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ForumPost" ADD CONSTRAINT "ForumPost_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ForumPost" ADD CONSTRAINT "ForumPost_pinnedById_fkey"
  FOREIGN KEY ("pinnedById") REFERENCES "Actor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ForumPost" ADD CONSTRAINT "ForumPost_acceptedReplyId_fkey"
  FOREIGN KEY ("acceptedReplyId") REFERENCES "ForumReply"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ForumPost" ADD CONSTRAINT "ForumPost_lastReplyAuthorId_fkey"
  FOREIGN KEY ("lastReplyAuthorId") REFERENCES "Actor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ForumPost_searchVector_idx" ON "ForumPost" USING GIN ("searchVector");
CREATE INDEX "ForumPost_title_trgm_idx" ON "ForumPost" USING GIN ("title" gin_trgm_ops);
CREATE INDEX "ForumPost_pinnedAt_lastActivityAt_id_idx" ON "ForumPost"("pinnedAt", "lastActivityAt", "id");
CREATE INDEX "ForumPost_projectId_lastActivityAt_id_idx" ON "ForumPost"("projectId", "lastActivityAt", "id");

-- ForumReply v2 threading, soft-tombstones, votes, and full-text search.
CREATE UNIQUE INDEX "ForumReply_id_postId_key" ON "ForumReply"("id", "postId");
ALTER TABLE "ForumReply"
  ADD COLUMN "parentReplyId" TEXT,
  ADD COLUMN "editedAt" TIMESTAMP(3),
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "voteCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "searchVector" tsvector GENERATED ALWAYS AS (
    to_tsvector('english', coalesce("body", ''))
  ) STORED;

ALTER TABLE "ForumReply" ADD CONSTRAINT "ForumReply_parentReplyId_postId_fkey"
  FOREIGN KEY ("parentReplyId", "postId") REFERENCES "ForumReply"("id", "postId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ForumReply" ADD CONSTRAINT "ForumReply_parent_self_check"
  CHECK ("parentReplyId" IS NULL OR "parentReplyId" <> "id");
ALTER TABLE "ForumReply" ADD CONSTRAINT "ForumReply_voteCount_check" CHECK ("voteCount" >= 0);
CREATE INDEX "ForumReply_parentReplyId_postId_idx" ON "ForumReply"("parentReplyId", "postId");
CREATE INDEX "ForumReply_searchVector_idx" ON "ForumReply" USING GIN ("searchVector");

-- Forum votes, reactions, issue links, and per-actor thread state.
CREATE TABLE "ForumPostVote" (
  "postId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ForumPostVote_pkey" PRIMARY KEY ("postId", "actorId"),
  CONSTRAINT "ForumPostVote_postId_fkey" FOREIGN KEY ("postId") REFERENCES "ForumPost"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ForumPostVote_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Actor"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "ForumReplyVote" (
  "replyId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ForumReplyVote_pkey" PRIMARY KEY ("replyId", "actorId"),
  CONSTRAINT "ForumReplyVote_replyId_fkey" FOREIGN KEY ("replyId") REFERENCES "ForumReply"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ForumReplyVote_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Actor"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "ForumReaction" (
  "id" TEXT NOT NULL,
  "postId" TEXT,
  "replyId" TEXT,
  "actorId" TEXT NOT NULL,
  "emoji" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ForumReaction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ForumReaction_target_check" CHECK (("postId" IS NOT NULL) <> ("replyId" IS NOT NULL)),
  CONSTRAINT "ForumReaction_postId_fkey" FOREIGN KEY ("postId") REFERENCES "ForumPost"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ForumReaction_replyId_fkey" FOREIGN KEY ("replyId") REFERENCES "ForumReply"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ForumReaction_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Actor"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ForumReaction_post_actor_emoji_key"
  ON "ForumReaction"("postId", "actorId", "emoji") WHERE "postId" IS NOT NULL;
CREATE UNIQUE INDEX "ForumReaction_reply_actor_emoji_key"
  ON "ForumReaction"("replyId", "actorId", "emoji") WHERE "replyId" IS NOT NULL;
CREATE INDEX "ForumReaction_postId_idx" ON "ForumReaction"("postId");
CREATE INDEX "ForumReaction_replyId_idx" ON "ForumReaction"("replyId");

CREATE TABLE "ForumIssueLink" (
  "postId" TEXT NOT NULL,
  "issueId" TEXT NOT NULL,
  "sourceReplyId" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ForumIssueLink_pkey" PRIMARY KEY ("postId", "issueId"),
  CONSTRAINT "ForumIssueLink_postId_fkey" FOREIGN KEY ("postId") REFERENCES "ForumPost"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ForumIssueLink_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ForumIssueLink_sourceReplyId_fkey" FOREIGN KEY ("sourceReplyId") REFERENCES "ForumReply"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ForumIssueLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Actor"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "ForumIssueLink_issueId_idx" ON "ForumIssueLink"("issueId");

CREATE TABLE "ForumThreadState" (
  "postId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "mode" TEXT,
  "lastReadAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ForumThreadState_pkey" PRIMARY KEY ("postId", "actorId"),
  CONSTRAINT "ForumThreadState_mode_check" CHECK ("mode" IS NULL OR "mode" IN ('subscribed', 'muted')),
  CONSTRAINT "ForumThreadState_postId_fkey" FOREIGN KEY ("postId") REFERENCES "ForumPost"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ForumThreadState_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Actor"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "ForumThreadState_actorId_mode_updatedAt_idx" ON "ForumThreadState"("actorId", "mode", "updatedAt");

-- Forum attachment associations.
ALTER TABLE "Attachment"
  ADD COLUMN "forumPostId" TEXT,
  ADD COLUMN "forumReplyId" TEXT;
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_forumPostId_fkey"
  FOREIGN KEY ("forumPostId") REFERENCES "ForumPost"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_forumReplyId_fkey"
  FOREIGN KEY ("forumReplyId") REFERENCES "ForumReply"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Attachment_forumPostId_idx" ON "Attachment"("forumPostId");
CREATE INDEX "Attachment_forumReplyId_idx" ON "Attachment"("forumReplyId");
