-- Turn explore turns into a tree so editing a question or regenerating an
-- answer forks a sibling instead of destroying what was there.
--
-- `ordinal` and its unique index cannot express this: sibling versions share a
-- depth, so at most one of them could ever hold a given ordinal. Ordering now
-- comes from walking parent pointers back to the root.
--
-- The table is recreated rather than altered because SQLite cannot drop a
-- column that participates in a unique index without a rebuild. These tables
-- were introduced in the same unmerged change and hold no data in any
-- environment, so there is nothing to migrate across.

-- AlterTable: which leaf the owner is reading, and the leaf a share is pinned to.
ALTER TABLE "ExploreConversation" ADD COLUMN "currentLeafId" TEXT;
ALTER TABLE "ExploreConversation" ADD COLUMN "sharedLeafId" TEXT;

-- RedefineTable
PRAGMA foreign_keys=OFF;

DROP TABLE "ExploreMessage";

CREATE TABLE "ExploreMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT NOT NULL,
    "parentId" TEXT,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "queryText" TEXT,
    "caveats" TEXT NOT NULL DEFAULT '[]',
    "followUps" TEXT NOT NULL DEFAULT '[]',
    "preview" TEXT,
    "visualization" TEXT,
    "trace" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExploreMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ExploreConversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ExploreMessage_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ExploreMessage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ExploreMessage_conversationId_idx" ON "ExploreMessage"("conversationId");

CREATE INDEX "ExploreMessage_conversationId_parentId_idx" ON "ExploreMessage"("conversationId", "parentId");

PRAGMA foreign_keys=ON;
