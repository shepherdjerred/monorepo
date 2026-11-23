CREATE TYPE "ActorKind" AS ENUM ('human', 'agent');

ALTER TABLE "ProcessedCommand"
  ADD COLUMN "tokenId" TEXT,
  ADD COLUMN "actorName" TEXT,
  ADD COLUMN "actorKind" "ActorKind";

CREATE TABLE "ApiToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "actorKind" "ActorKind" NOT NULL DEFAULT 'agent',
    "tokenPrefix" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "scopes" TEXT[] NOT NULL DEFAULT ARRAY['read', 'write']::TEXT[],
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ApiToken_tokenHash_key" ON "ApiToken"("tokenHash");
CREATE INDEX "ApiToken_userId_createdAt_idx" ON "ApiToken"("userId", "createdAt");

ALTER TABLE "ApiToken"
  ADD CONSTRAINT "ApiToken_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "MutationEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "syncSeq" BIGINT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "commandUuid" TEXT,
    "requestId" TEXT NOT NULL,
    "actorKind" "ActorKind" NOT NULL,
    "actorName" TEXT NOT NULL,
    "tokenId" TEXT,
    "tokenPrefix" TEXT,
    "actorMetadata" JSONB,
    "changes" JSONB NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MutationEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MutationEvent_userId_createdAt_id_idx" ON "MutationEvent"("userId", "createdAt", "id");
CREATE INDEX "MutationEvent_userId_entityType_entityId_createdAt_idx" ON "MutationEvent"("userId", "entityType", "entityId", "createdAt");
CREATE INDEX "MutationEvent_tokenId_createdAt_idx" ON "MutationEvent"("tokenId", "createdAt");

ALTER TABLE "MutationEvent"
  ADD CONSTRAINT "MutationEvent_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MutationEvent"
  ADD CONSTRAINT "MutationEvent_tokenId_fkey"
  FOREIGN KEY ("tokenId") REFERENCES "ApiToken"("id") ON DELETE SET NULL ON UPDATE CASCADE;
