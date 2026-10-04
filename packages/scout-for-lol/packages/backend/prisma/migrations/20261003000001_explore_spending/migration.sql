ALTER TABLE "ExploreConversation" ADD COLUMN "preferredModel" TEXT;
ALTER TABLE "ExploreMessage" ADD COLUMN "generation" TEXT;
ALTER TABLE "ExploreMessage" ADD COLUMN "inlineEntities" TEXT;
CREATE TABLE "ExploreSpend" (
  "id" TEXT NOT NULL, "runId" TEXT NOT NULL, "ownerId" TEXT NOT NULL,
  "month" TEXT NOT NULL, "model" TEXT NOT NULL, "reservedMicros" INTEGER NOT NULL,
  "budgetMicros" INTEGER NOT NULL, "state" TEXT NOT NULL DEFAULT 'held',
  "usage" TEXT, "responseId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "settledAt" TIMESTAMP(3), CONSTRAINT "ExploreSpend_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ExploreSpend_month_ownerId_idx" ON "ExploreSpend"("month", "ownerId");
CREATE INDEX "ExploreSpend_runId_idx" ON "ExploreSpend"("runId");
ALTER TABLE "ExploreSpend" ADD CONSTRAINT "ExploreSpend_amounts_check" CHECK ("reservedMicros" >= 0 AND "budgetMicros" >= 0);
CREATE TABLE "ExploreSandboxLease" ("id" TEXT NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "ExploreSandboxLease_pkey" PRIMARY KEY ("id"));
