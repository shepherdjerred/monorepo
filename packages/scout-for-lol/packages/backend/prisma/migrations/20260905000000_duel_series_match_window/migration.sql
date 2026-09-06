ALTER TABLE "DuelSeries"
    ADD COLUMN "matchWindowHours" INTEGER NOT NULL DEFAULT 168;

ALTER TABLE "DuelSeries"
    ADD CONSTRAINT "DuelSeries_matchWindowHours_check" CHECK ("matchWindowHours" BETWEEN 24 AND 336);
