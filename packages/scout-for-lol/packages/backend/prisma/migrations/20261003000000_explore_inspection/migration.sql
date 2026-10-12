CREATE TABLE "ExploreToolPayload" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "toolCallId" TEXT NOT NULL,
  "toolName" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "payload" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExploreToolPayload_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ExploreToolPayload_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ExploreConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ExploreToolPayload_conversationId_toolCallId_direction_key" ON "ExploreToolPayload"("conversationId", "toolCallId", "direction");
CREATE INDEX "ExploreToolPayload_runId_idx" ON "ExploreToolPayload"("runId");
