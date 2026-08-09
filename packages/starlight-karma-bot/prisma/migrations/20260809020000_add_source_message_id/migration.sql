-- AlterTable
ALTER TABLE "karma" ADD COLUMN "sourceMessageId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "karma_giverId_sourceMessageId_key" ON "karma"("giverId", "sourceMessageId");

