-- CreateTable
CREATE TABLE "ExploreAttachment" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "questionId" TEXT,
    "position" INTEGER,
    "objectKey" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "heldUntil" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExploreAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExploreAttachmentUpload" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExploreAttachmentUpload_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExploreAttachment_objectKey_key" ON "ExploreAttachment"("objectKey");

-- CreateIndex
CREATE INDEX "ExploreAttachment_questionId_idx" ON "ExploreAttachment"("questionId");

-- CreateIndex
CREATE INDEX "ExploreAttachment_ownerId_createdAt_idx" ON "ExploreAttachment"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "ExploreAttachmentUpload_ownerId_createdAt_idx" ON "ExploreAttachmentUpload"("ownerId", "createdAt");

-- AddForeignKey
ALTER TABLE "ExploreAttachment" ADD CONSTRAINT "ExploreAttachment_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "ExploreMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

