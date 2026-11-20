-- TMDB artwork for owned movies and series. Presentation only: every column is
-- nullable, nothing is backfilled here, and the six-hourly due sweep observes
-- existing titles through the ordinary catalog refresh.
ALTER TABLE "MediaItem"
  ADD COLUMN "posterPath" TEXT,
  ADD COLUMN "backdropPath" TEXT,
  ADD COLUMN "overview" TEXT,
  ADD COLUMN "artworkObservedAt" TIMESTAMP(3);
