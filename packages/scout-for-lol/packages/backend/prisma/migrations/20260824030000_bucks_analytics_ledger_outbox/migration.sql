CREATE TABLE "BucksAnalyticsLedgerOutbox" (
    "id" SERIAL NOT NULL,
    "ledgerEntryId" INTEGER NOT NULL,
    "eventId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BucksAnalyticsLedgerOutbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BucksAnalyticsLedgerOutbox_ledgerEntryId_key" ON "BucksAnalyticsLedgerOutbox"("ledgerEntryId");
CREATE UNIQUE INDEX "BucksAnalyticsLedgerOutbox_eventId_key" ON "BucksAnalyticsLedgerOutbox"("eventId");
CREATE INDEX "BucksAnalyticsLedgerOutbox_createdAt_idx" ON "BucksAnalyticsLedgerOutbox"("createdAt");

ALTER TABLE "BucksAnalyticsLedgerOutbox" ADD CONSTRAINT "BucksAnalyticsLedgerOutbox_ledgerEntryId_fkey" FOREIGN KEY ("ledgerEntryId") REFERENCES "BucksLedgerEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
