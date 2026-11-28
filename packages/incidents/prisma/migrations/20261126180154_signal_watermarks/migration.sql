-- CreateTable
CREATE TABLE "signal_watermarks" (
    "source" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "last_observed_at" TIMESTAMPTZ(6) NOT NULL,
    "firing" BOOLEAN NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "signal_watermarks_pkey" PRIMARY KEY ("source","key")
);
