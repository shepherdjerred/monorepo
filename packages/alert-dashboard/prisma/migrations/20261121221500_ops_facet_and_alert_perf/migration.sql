-- CreateTable
CREATE TABLE "OpsFacet" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "generatedAtNs" BIGINT NOT NULL,
    "receivedAtNs" BIGINT NOT NULL,
    "payload" JSONB NOT NULL
);

-- CreateIndex
CREATE INDEX "OpsFacet_receivedAtNs_idx" ON "OpsFacet"("receivedAtNs");
