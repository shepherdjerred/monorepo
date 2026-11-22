CREATE TABLE "SeerrRequestApproval" (
    "provenanceKey" TEXT NOT NULL,
    "captureId" TEXT NOT NULL,
    "captureCompletedAt" TIMESTAMP(3) NOT NULL,
    "receiptId" TEXT NOT NULL,
    "plexAccountId" TEXT,
    "pending" BOOLEAN NOT NULL,
    "attachmentEventId" TEXT,
    CONSTRAINT "SeerrRequestApproval_pkey" PRIMARY KEY ("provenanceKey"),
    CONSTRAINT "seerr_request_approval_pending_account" CHECK (
        NOT "pending" OR ("plexAccountId" IS NOT NULL AND "attachmentEventId" IS NULL)
    )
);

CREATE INDEX "SeerrRequestApproval_plexAccountId_pending_idx"
    ON "SeerrRequestApproval" ("plexAccountId", "pending");
