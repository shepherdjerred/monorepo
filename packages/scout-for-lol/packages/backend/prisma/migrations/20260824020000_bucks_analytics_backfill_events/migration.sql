CREATE TABLE "BucksAnalyticsBackfillEvent" (
    "id" SERIAL NOT NULL,
    "eventId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BucksAnalyticsBackfillEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BucksAnalyticsBackfillEvent_eventId_key" ON "BucksAnalyticsBackfillEvent"("eventId");
