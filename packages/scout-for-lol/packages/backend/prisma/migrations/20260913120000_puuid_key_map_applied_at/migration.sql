-- Records that `apply` completed against this database. Derived cutover
-- detection was wrong: it read the tracked rows, which churn, so a database
-- whose migrated accounts were later untracked read as unmigrated.
ALTER TABLE "PuuidKeyMap" ADD COLUMN IF NOT EXISTS "appliedAt" TIMESTAMPTZ;
