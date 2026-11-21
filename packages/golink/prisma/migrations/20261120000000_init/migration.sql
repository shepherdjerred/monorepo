-- CreateTable
CREATE TABLE "manual_links" (
    "short" TEXT NOT NULL,
    "target_url" TEXT NOT NULL,
    "created_by" TEXT NOT NULL DEFAULT '',
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "last_clicked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "manual_links_pkey" PRIMARY KEY ("short")
);
