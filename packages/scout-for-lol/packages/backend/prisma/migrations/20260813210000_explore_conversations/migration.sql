-- CreateTable
CREATE TABLE "ExploreConversation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "shareToken" TEXT,
    "sharedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ExploreConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("discordId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExploreMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "queryText" TEXT,
    "caveats" TEXT NOT NULL DEFAULT '[]',
    "followUps" TEXT NOT NULL DEFAULT '[]',
    "preview" TEXT,
    "visualization" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExploreMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ExploreConversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ExploreConversation_shareToken_key" ON "ExploreConversation"("shareToken");

-- CreateIndex
CREATE INDEX "ExploreConversation_userId_updatedAt_idx" ON "ExploreConversation"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "ExploreMessage_conversationId_idx" ON "ExploreMessage"("conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "ExploreMessage_conversationId_ordinal_key" ON "ExploreMessage"("conversationId", "ordinal");
