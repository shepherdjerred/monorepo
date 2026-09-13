-- Records whether this database has been rewritten to a new Riot key domain.
--
-- A single row rather than a flag on the mapping: a cutover performed while
-- tracking no accounts still moves the database, and that must be recordable
-- with an empty map. Deriving the answer from tracked rows or from mapping rows
-- fails in exactly those cases.
CREATE TABLE IF NOT EXISTS "PuuidKeyMigration" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "appliedAt" TIMESTAMPTZ,

    CONSTRAINT "PuuidKeyMigration_pkey" PRIMARY KEY ("id")
);
